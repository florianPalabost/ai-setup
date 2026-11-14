import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { open, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { ERROR_CODES, FactoryError } from './constants.mjs'
import { STEP_STATUSES, describeToolUse, isCodingStep, latestRun, parseJsonLine } from './progress.mjs'
import { worktreePathFor } from './worktree.mjs'

const WATCH_POLL_MS = 1000
const STEP_MARKS = { done: '✓', pass: '✓', fail: '✗', error: '✗', running: '▸' }

const sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds))

async function requireRun(repo, issueNumber) {
    const run = await latestRun({ root: repo.root, gitDir: repo.gitDir, issueNumber })
    if (!run) {
        throw new FactoryError(ERROR_CODES.noRun, `#${issueNumber} has no factory run with recorded progress`)
    }

    return run
}

/** One readable line per transcript event worth seeing: the agent's messages, its tool calls, failed tool results and the final result. */
function formatEvent(event) {
    if (event?.type === 'assistant') {
        return (event.message?.content ?? [])
            .map((part) => {
                if (part.type === 'tool_use') {
                    return `  ▸ ${describeToolUse(part)}`
                }

                return part.type === 'text' && part.text.trim() ? `  ${part.text.trim().replaceAll('\n', '\n  ')}` : null
            })
            .filter(Boolean)
    }
    if (event?.type === 'user') {
        const failed = (event.message?.content ?? []).filter((part) => part.type === 'tool_result' && part.is_error)

        return failed.map((part) => `  ✗ ${String(Array.isArray(part.content) ? part.content.map((item) => item.text ?? '').join(' ') : part.content).split('\n')[0]}`)
    }
    if (event?.type === 'result') {
        return [`  ■ ${event.subtype}${event.total_cost_usd ? ` · $${event.total_cost_usd.toFixed(2)}` : ''}`]
    }

    return []
}

/** Reads a transcript from `offset` on, keeping a trailing partial line for the next read. */
async function readNewLines(path, cursor) {
    if (!existsSync(path)) {
        return []
    }
    const { size } = await stat(path)
    if (size <= cursor.offset) {
        return []
    }
    const file = await open(path)
    const { buffer, bytesRead } = await file.read({ buffer: Buffer.alloc(size - cursor.offset), position: cursor.offset })
    await file.close()
    cursor.offset += bytesRead
    const lines = (cursor.partial + buffer.subarray(0, bytesRead).toString('utf8')).split('\n')
    cursor.partial = lines.pop()

    return lines
}

/**
 * Follows a ticket's latest run in the terminal: each step as it starts and ends, and the running agent's
 * transcript as readable lines. Returns once the run records its outcome.
 */
export async function watchRun({ repo, issueNumber, write = (text) => process.stdout.write(`${text}\n`) }) {
    const cursors = new Map()
    const announced = new Map()
    let shownDetail = null

    for (;;) {
        const run = await requireRun(repo, issueNumber)
        for (const step of run.steps) {
            if (announced.get(step.name) !== step.status && step.status === STEP_STATUSES.running) {
                write(`\n── ${step.name} ──${step.sessionId ? ` session ${step.sessionId}` : ''}`)
            }
            if (step.log) {
                const cursor = cursors.get(step.name) ?? { offset: 0, partial: '' }
                cursors.set(step.name, cursor)
                const lines = (await readNewLines(join(repo.root, step.log), cursor)).flatMap((line) => formatEvent(parseJsonLine(line)))
                lines.forEach((line) => write(line))
            } else if (step.status === STEP_STATUSES.running && step.detail && step.detail !== shownDetail) {
                shownDetail = step.detail
                write(`  ▸ ${step.detail}`)
            }
            if (announced.get(step.name) !== step.status && step.status !== STEP_STATUSES.running) {
                write(`${STEP_MARKS[step.status] ?? '·'} ${step.name}: ${step.status}${step.status === STEP_STATUSES.error && step.detail ? ` (${step.detail})` : ''}`)
            }
            announced.set(step.name, step.status)
        }
        if (run.finishedAt) {
            write(`\n■ run finished: ${run.outcome}`)
            return
        }
        await sleep(WATCH_POLL_MS)
    }
}

/**
 * Opens an interactive Claude on a step's session, in the ticket's worktree: by default the last coding step
 * (implement or a rework), so the human carries on with the agent's full context.
 */
export async function resumeSession({ repo, issueNumber, stepName, force }) {
    const run = await requireRun(repo, issueNumber)
    const running = run.steps.findLast((step) => step.status === STEP_STATUSES.running)
    if (!run.finishedAt && !force) {
        throw new FactoryError(ERROR_CODES.runInProgress, `the run on #${issueNumber} is still at "${running?.name ?? 'starting'}": watch it with factory watch ${issueNumber}, or pass --force to resume beside it`)
    }
    const step = stepName ? run.steps.find((candidate) => candidate.name === stepName) : run.steps.findLast((candidate) => isCodingStep(candidate.name) && candidate.sessionId)
    if (!step?.sessionId) {
        throw new FactoryError(ERROR_CODES.noSession, `no Claude session for ${stepName ? `step "${stepName}"` : 'a coding step'} in the run on #${issueNumber} (steps: ${run.steps.map((candidate) => candidate.name).join(', ')})`)
    }
    const worktree = worktreePathFor(repo.root, issueNumber)
    if (!existsSync(worktree)) {
        throw new FactoryError(ERROR_CODES.noWorktree, `the worktree ${worktree} is gone`)
    }

    console.log(`▸ resuming the ${step.name} session ${step.sessionId} in ${worktree}`)
    const { status } = spawnSync('claude', ['--resume', step.sessionId], { cwd: worktree, stdio: 'inherit' })
    process.exitCode = status ?? 1
}
