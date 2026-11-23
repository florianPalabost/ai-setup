export const DEMO_RUN_ID = 'demo'
export const DEMO_RUN = { id: DEMO_RUN_ID, objective: 'Demo · sample factory run, replays every 80 s' }

const STEP_MS = 4000
const HOLD_STEPS = 5
const DEMO_EPOCH = Date.now()
const DEMO_OUTCOME = 'agent-done'

/**
 * @type {Array<{ name: string, end: number, status?: string, agent?: boolean }>}
 */
const TIMELINE = [
    { name: 'setup', end: 1 },
    { name: 'implement', end: 5, agent: true },
    { name: 'checks 1', end: 6, status: 'fail' },
    { name: 'rework 1/2', end: 8, agent: true },
    { name: 'checks 2', end: 9, status: 'pass' },
    { name: 'review 2', end: 12, status: 'pass', agent: true },
    { name: 'push', end: 13 },
    { name: 'PR body', end: 14, agent: true },
    { name: 'draft PR', end: 15 },
]
const CYCLE_STEPS = TIMELINE.at(-1).end + HOLD_STEPS

export function demoRun(now) {
    const elapsed = now - DEMO_EPOCH
    const cycleStart = DEMO_EPOCH + Math.floor(elapsed / (CYCLE_STEPS * STEP_MS)) * CYCLE_STEPS * STEP_MS
    const step = Math.floor((now - cycleStart) / STEP_MS)
    const at = (stepIndex) => new Date(cycleStart + stepIndex * STEP_MS).toISOString()

    const steps = TIMELINE.map((entry, index) => ({ ...entry, start: index === 0 ? 0 : TIMELINE[index - 1].end }))
        .filter((entry) => step >= entry.start)
        .map((entry) => ({
            name: entry.name,
            status: step >= entry.end ? entry.status ?? 'done' : 'running',
            sessionId: entry.agent ? `demo-${entry.name}` : null,
            detail: null,
            startedAt: at(entry.start),
            updatedAt: at(Math.min(step, entry.end)),
        }))
    const finished = step >= TIMELINE.at(-1).end

    return { startedAt: at(0), finishedAt: finished ? at(TIMELINE.at(-1).end) : null, outcome: finished ? DEMO_OUTCOME : null, steps }
}
