import { existsSync } from 'node:fs'
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { ERROR_CODES, FactoryError } from './constants.mjs'
import { STEP_STATUSES, latestRun, parseJsonLine } from './progress.mjs'

const RUN_MARKDOWN_FILE = 'run.md'
const MAX_TOOL_INPUT_LINES = 12
const MAX_ERROR_LENGTH = 300
const STEP_MARKS = { done: '✓', pass: '✓', fail: '✗', error: '✗', running: '▸' }
const TOOL_INPUT_KEYS = ['command', 'file_path', 'path', 'pattern', 'skill', 'url', 'description', 'prompt']

const fence = (text, language = '') => `\`\`\`${language}\n${text}\n\`\`\``

/** Pushes the agent's own headings below the step's heading, so its "## Summary" doesn't sit beside the steps. */
const demoteHeadings = (markdown) => markdown.replace(/^(#{1,4}) /gm, '$1## ')

function clip(text, maxLines) {
    const lines = text.split('\n')

    return lines.length > maxLines ? `${lines.slice(0, maxLines).join('\n')}\n… ${lines.length - maxLines} more lines` : text
}

function minutesBetween(start, end) {
    const minutes = Math.round((new Date(end) - new Date(start)) / 60000)

    return minutes < 1 ? '<1 min' : `${minutes} min`
}

function toolCall({ name, input = {} }) {
    const shown = TOOL_INPUT_KEYS.map((key) => input[key]).find((value) => typeof value === 'string')
    if (!shown) {
        return `- **${name}**`
    }
    if (!shown.includes('\n')) {
        return `- **${name}** \`${shown.replaceAll('`', 'ˋ')}\``
    }

    return `- **${name}**\n\n${fence(clip(shown, MAX_TOOL_INPUT_LINES), name === 'Bash' ? 'sh' : '')}`
}

function toolError(part) {
    const text = Array.isArray(part.content) ? part.content.map((item) => item.text ?? '').join(' ') : String(part.content ?? '')

    return `- ✗ ${text.trim().split('\n')[0].slice(0, MAX_ERROR_LENGTH)}`
}

/** A structured result (a review's verdict and findings, a PR body) as prose: strings as Markdown, lists as bullets. */
function structuredOutput(output) {
    return Object.entries(output).flatMap(([key, value]) => {
        if (typeof value === 'string') {
            return value.includes('\n') ? [`**${key}**`, demoteHeadings(value)] : [`**${key}:** ${value}`]
        }
        if (Array.isArray(value)) {
            return value.length === 0 ? [`**${key}:** none`] : [`**${key}**`, value.map((item) => `- ${typeof item === 'string' ? item.replaceAll('\n', '\n  ') : JSON.stringify(item)}`).join('\n')]
        }

        return [`**${key}:** \`${JSON.stringify(value)}\``]
    })
}

/** One step's stream-json transcript as readable blocks: the agent's messages, its tool calls, failed tool results and its result. */
function transcriptBlocks(events) {
    const blocks = []
    for (const event of events) {
        if (event?.type === 'assistant') {
            for (const part of event.message?.content ?? []) {
                if (part.type === 'text' && part.text.trim()) {
                    blocks.push(demoteHeadings(part.text.trim()))
                } else if (part.type === 'tool_use' && part.name !== 'StructuredOutput') {
                    blocks.push(toolCall(part))
                }
            }
        } else if (event?.type === 'user') {
            const errors = (event.message?.content ?? []).filter((part) => part.type === 'tool_result' && part.is_error)
            if (errors.length > 0) {
                blocks.push(errors.map(toolError).join('\n'))
            }
        }
    }
    const result = events.findLast((event) => event?.type === 'result')
    if (result?.structured_output) {
        blocks.push('#### Result', ...structuredOutput(result.structured_output))
    } else if (result?.result && blocks.at(-1) !== demoteHeadings(result.result.trim())) {
        blocks.push('#### Result', demoteHeadings(result.result))
    }

    return blocks
}

function stepFacts(step, events) {
    const init = events.find((event) => event?.type === 'system' && event.subtype === 'init')
    const result = events.findLast((event) => event?.type === 'result')

    return [
        `${STEP_MARKS[step.status] ?? '·'} ${step.status}`,
        minutesBetween(step.startedAt, step.updatedAt),
        init?.model && `\`${init.model}\``,
        result?.total_cost_usd && `$${result.total_cost_usd.toFixed(2)}`,
        step.sessionId && `session \`${step.sessionId}\``,
        step.status === STEP_STATUSES.error && step.detail && `\`${step.detail}\``,
    ]
        .filter(Boolean)
        .join(' · ')
}

async function readEvents(repo, step) {
    const path = step.log ? join(repo.root, step.log) : null
    if (!path || !existsSync(path)) {
        return []
    }

    return (await readFile(path, 'utf8')).split('\n').map(parseJsonLine).filter(Boolean)
}

/**
 * Writes the ticket's latest run as Markdown a person can read: every step with its timing, model and cost,
 * and each agent's transcript. With `stepName`, only that step, as `<step log>.md`.
 * @returns {Promise<{ path: string }>} the path relative to the repo root
 */
export async function writeRunMarkdown({ repo, issueNumber, stepName }) {
    const run = await latestRun({ root: repo.root, gitDir: repo.gitDir, issueNumber })
    if (!run) {
        throw new FactoryError(ERROR_CODES.noRun, `#${issueNumber} has no factory run with recorded progress`)
    }
    const steps = stepName ? run.steps.filter((step) => step.name === stepName && step.log) : run.steps
    if (steps.length === 0) {
        throw new FactoryError(ERROR_CODES.noRun, `the run on #${issueNumber} has no step "${stepName}" with a transcript (steps: ${run.steps.map((step) => step.name).join(', ')})`)
    }

    const blocks = [
        `# #${issueNumber} · ${stepName ?? 'factory run'}`,
        [run.outcome ? `**${run.outcome}**` : '**still running**', `started ${run.startedAt}`, run.finishedAt && `took ${minutesBetween(run.startedAt, run.finishedAt)}`].filter(Boolean).join(' · '),
        run.steps.map((step) => `${STEP_MARKS[step.status] ?? '·'} ${step.name}`).join(' → '),
    ]
    for (const step of steps) {
        const events = await readEvents(repo, step)
        blocks.push(`## ${step.name}`, stepFacts(step, events), ...transcriptBlocks(events))
    }

    const path = stepName ? steps[0].log.replace(/\.jsonl$/, '.md') : join(run.dir, RUN_MARKDOWN_FILE)
    await writeFile(join(repo.root, path), `${blocks.join('\n\n')}\n`)

    return { path }
}
