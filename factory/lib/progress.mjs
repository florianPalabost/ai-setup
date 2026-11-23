import { existsSync } from 'node:fs'
import { appendFile, open, readdir, readFile, stat } from 'node:fs/promises'
import { join, relative } from 'node:path'
import { SYSTEM_ERROR_CODES } from './constants.mjs'

export const PROGRESS_FILE = 'progress.jsonl'

export const WATCH_LOG_FILE = 'watch.log'

export const STEP_STATUSES = Object.freeze({
    running: 'running',
    done: 'done',
    pass: 'pass',
    fail: 'fail',
    error: 'error',
})

export const RUN_STEP = 'run'

export const RUN_ABANDONED = 'abandoned'

export const STEP_NAMES = Object.freeze({
    baseline: 'baseline',
    setup: 'setup',
    implement: 'implement',
    checks: (attempt) => `checks ${attempt}`,
    review: (attempt) => `review ${attempt}`,
    rework: (rework, maxReworks) => `rework ${rework}/${maxReworks}`,
    push: 'push',
    prBody: 'PR body',
    draftPr: 'draft PR',
})

export const isCodingStep = (name) => name === STEP_NAMES.implement || name.startsWith('rework ')

const TRANSCRIPT_TAIL_BYTES = 64 * 1024
const TRANSCRIPT_HEAD_BYTES = 64 * 1024
const ACTIVITY_MAX_LENGTH = 120

export const issueRunsDir = (gitDir, issueNumber) => join(gitDir, 'factory', `issue-${issueNumber}`)

/**
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

export const parseJsonLine = (line) => {
    try {
        return JSON.parse(line)
    } catch {
        return null
    }
}

export function describeToolUse({ name, input = {} }) {
    const target = input.file_path ?? input.path ?? input.command ?? input.pattern ?? input.description ?? ''

    return `${name} ${String(target).split('\n')[0]}`.trim()
}

async function readSlice(path, position, length) {
    const file = await open(path)
    try {
        const { buffer, bytesRead } = await file.read({ buffer: Buffer.alloc(length), position })

        return buffer.subarray(0, bytesRead).toString('utf8')
    } finally {
        await file.close()
    }
}

async function sessionIdOf(transcriptPath) {
    if (!existsSync(transcriptPath)) {
        return null
    }
    const head = await readSlice(transcriptPath, 0, TRANSCRIPT_HEAD_BYTES)

    return head.split('\n').map(parseJsonLine).find((event) => event?.type === 'system' && event.subtype === 'init')?.session_id ?? null
}

async function latestActivity(transcriptPath) {
    const { size } = await stat(transcriptPath)
    const start = Math.max(0, size - TRANSCRIPT_TAIL_BYTES)
    const events = (await readSlice(transcriptPath, start, size - start)).split('\n').reverse().map(parseJsonLine)
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

/** Whether the process that started a run is still alive: EPERM means it exists but belongs to someone else. */
function isAlive(pid) {
    try {
        process.kill(pid, 0)

        return true
    } catch (error) {
        return error.code === SYSTEM_ERROR_CODES.notPermitted
    }
}

function runEnd(entries) {
    const runEntries = entries.filter((entry) => entry.step === RUN_STEP)
    const finish = runEntries.findLast((entry) => entry.status !== STEP_STATUSES.running)
    if (finish) {
        return { finishedAt: finish.at, outcome: finish.status }
    }
    const pid = runEntries.find((entry) => entry.status === STEP_STATUSES.running)?.pid
    if (pid && !isAlive(pid)) {
        return { finishedAt: entries.at(-1).at, outcome: RUN_ABANDONED }
    }

    return { finishedAt: null, outcome: null }
}

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
 * @returns {Promise<null | { dir: string, startedAt: string, finishedAt: string|null, outcome: string|null, steps: { name: string, status: string, log: string|null, sessionId: string|null, detail: string|null, startedAt: string, updatedAt: string }[], activity: string|null, updatedAt: string }>}
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
    const { finishedAt, outcome } = runEnd(entries)
    const relativeToRoot = (name) => relative(root, join(runDir, name))
    const running = steps.findLast((step) => step.status === STEP_STATUSES.running)
    const runningTranscript = running?.log ? join(runDir, running.log) : null
    const transcriptStats = runningTranscript && existsSync(runningTranscript) ? await stat(runningTranscript) : null

    return {
        dir: relative(root, runDir),
        startedAt: entries[0]?.at ?? null,
        finishedAt,
        outcome,
        steps: await Promise.all(
            steps.map(async (step) => ({ ...step, log: step.log ? relativeToRoot(step.log) : null, sessionId: step.log ? await sessionIdOf(join(runDir, step.log)) : null })),
        ),
        activity: transcriptStats ? await latestActivity(runningTranscript) : running?.detail ?? null,
        updatedAt: transcriptStats?.mtime.toISOString() ?? entries.at(-1)?.at ?? null,
    }
}

export async function issuesWithRuns(gitDir) {
    const factoryDir = join(gitDir, 'factory')
    if (!existsSync(factoryDir)) {
        return []
    }

    return (await readdir(factoryDir)).map((name) => /^issue-(\d+)$/.exec(name)?.[1]).filter(Boolean).map(Number)
}
