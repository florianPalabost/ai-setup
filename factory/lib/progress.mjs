import { existsSync } from 'node:fs'
import { appendFile, open, readdir, readFile, stat } from 'node:fs/promises'
import { join, relative } from 'node:path'

export const PROGRESS_FILE = 'progress.jsonl'

export const STEP_STATUSES = Object.freeze({
    running: 'running',
    done: 'done',
    pass: 'pass',
    fail: 'fail',
    error: 'error',
})

export const RUN_STEP = 'run'

const TRANSCRIPT_TAIL_BYTES = 64 * 1024
const ACTIVITY_MAX_LENGTH = 120

export const issueRunsDir = (gitDir, issueNumber) => join(gitDir, 'factory', `issue-${issueNumber}`)

/**
 * Appends a run's step changes to progress.jsonl, the file `factory status` reads to show a run live.
 * @returns {{ record: (entry: { step: string, status: string, log?: string, detail?: string }) => Promise<void>, track: <T>(step: string, work: () => Promise<T>, options?: { log?: string, statusOf?: (result: T) => string }) => Promise<T> }}
 */
export function progressRecorder(runDir) {
    const record = (entry) => appendFile(join(runDir, PROGRESS_FILE), `${JSON.stringify({ at: new Date().toISOString(), ...entry })}\n`)

    async function track(step, work, { log, statusOf = () => STEP_STATUSES.done } = {}) {
        await record({ step, status: STEP_STATUSES.running, log })
        let result
        try {
            result = await work()
        } catch (error) {
            await record({ step, status: STEP_STATUSES.error, detail: error.message })
            throw error
        }
        await record({ step, status: statusOf(result) })

        return result
    }

    return { record, track }
}

const parseJsonLine = (line) => {
    try {
        return JSON.parse(line)
    } catch {
        return null
    }
}

function describeToolUse({ name, input = {} }) {
    const target = input.file_path ?? input.path ?? input.command ?? input.pattern ?? input.description ?? ''

    return `${name} ${String(target).split('\n')[0]}`.trim()
}

/** What an agent step is doing now: its newest tool call or message, read from the end of its stream-json transcript. */
async function latestActivity(transcriptPath) {
    const { size } = await stat(transcriptPath)
    const start = Math.max(0, size - TRANSCRIPT_TAIL_BYTES)
    const file = await open(transcriptPath)
    const { buffer, bytesRead } = await file.read({ buffer: Buffer.alloc(size - start), position: start })
    await file.close()

    const events = buffer.subarray(0, bytesRead).toString('utf8').split('\n').reverse().map(parseJsonLine)
    for (const event of events) {
        const content = event?.type === 'assistant' ? event.message?.content ?? [] : []
        const toolUse = content.findLast((part) => part.type === 'tool_use')
        if (toolUse) {
            return describeToolUse(toolUse).slice(0, ACTIVITY_MAX_LENGTH)
        }
        const text = content.findLast((part) => part.type === 'text')?.text?.trim()
        if (text) {
            return text.split('\n')[0].slice(0, ACTIVITY_MAX_LENGTH)
        }
    }

    return null
}

/** Replays progress.jsonl into one entry per step, in the order the steps started. */
function foldSteps(entries) {
    const steps = new Map()
    for (const { step, status, log, detail, at } of entries) {
        if (step === RUN_STEP) {
            continue
        }
        const previous = steps.get(step) ?? { name: step, startedAt: at }
        steps.set(step, { ...previous, status, log: log ?? previous.log ?? null, detail: detail ?? previous.detail ?? null, updatedAt: at })
    }

    return [...steps.values()]
}

/**
 * The newest run on a ticket that recorded progress, with log paths relative to the repo root.
 * @returns {Promise<null | { dir: string, startedAt: string, finishedAt: string|null, outcome: string|null, steps: { name: string, status: string, log: string|null, detail: string|null, startedAt: string, updatedAt: string }[], activity: string|null, updatedAt: string }>}
 */
export async function latestRun({ root, gitDir, issueNumber }) {
    const runsDir = issueRunsDir(gitDir, issueNumber)
    if (!existsSync(runsDir)) {
        return null
    }
    const runNames = (await readdir(runsDir)).filter((name) => existsSync(join(runsDir, name, PROGRESS_FILE))).sort()
    if (runNames.length === 0) {
        return null
    }

    const runDir = join(runsDir, runNames.at(-1))
    const entries = (await readFile(join(runDir, PROGRESS_FILE), 'utf8')).split('\n').map(parseJsonLine).filter(Boolean)
    const steps = foldSteps(entries)
    const finish = entries.findLast((entry) => entry.step === RUN_STEP)
    const relativeToRoot = (name) => relative(root, join(runDir, name))
    const running = steps.findLast((step) => step.status === STEP_STATUSES.running)
    const runningTranscript = running?.log ? join(runDir, running.log) : null
    const transcriptStats = runningTranscript && existsSync(runningTranscript) ? await stat(runningTranscript) : null

    return {
        dir: relative(root, runDir),
        startedAt: entries[0]?.at ?? null,
        finishedAt: finish?.at ?? null,
        outcome: finish?.status ?? null,
        steps: steps.map((step) => ({ ...step, log: step.log ? relativeToRoot(step.log) : null })),
        activity: transcriptStats ? await latestActivity(runningTranscript) : running?.detail ?? null,
        updatedAt: transcriptStats?.mtime.toISOString() ?? entries.at(-1)?.at ?? null,
    }
}

/** Issue numbers that have a runs directory under .git/factory. */
export async function issuesWithRuns(gitDir) {
    const factoryDir = join(gitDir, 'factory')
    if (!existsSync(factoryDir)) {
        return []
    }

    return (await readdir(factoryDir)).map((name) => /^issue-(\d+)$/.exec(name)?.[1]).filter(Boolean).map(Number)
}
