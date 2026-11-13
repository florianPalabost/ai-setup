export const DEMO_RUN_ID = 'demo'
export const DEMO_RUN = { id: DEMO_RUN_ID, objective: 'Demo · sample run, replays every 80 s' }

const STEP_MS = 4000
const HOLD_STEPS = 5
const DEMO_EPOCH = Date.now()

/**
 * One ticket pipeline replayed step by step, so status changes, a gate being
 * resolved and the all-completed state can be checked without a real run.
 *
 * @type {Array<{ id: string, name: string, deps: string[], parentId?: string, agent: string | null, start: number, end: number, outcome?: string }>}
 */
const TIMELINE = [
    { id: 'setup', name: 'Set up branch fix/42-invoice-export', deps: [], agent: null, start: 0, end: 1 },
    { id: 'audit', name: 'Audit callers', deps: ['setup'], agent: 'claude', start: 1, end: 4 },
    { id: 'scope', name: 'Change the export scope', deps: ['setup'], agent: 'codex', start: 4, end: 7 },
    { id: 'fix', name: 'Fix callers', deps: ['audit', 'scope'], agent: 'claude', start: 7, end: 9 },
    { id: 'verify', name: 'Verify: suite, Larastan, Pint', deps: ['fix'], agent: 'claude', start: 9, end: 10 },
    { id: 'review', name: 'Review (matt-code-review)', deps: ['verify'], agent: 'claude', start: 10, end: 13 },
    { id: 'review-standards', name: 'Standards review', deps: [], parentId: 'review', agent: 'claude', start: 10, end: 12 },
    { id: 'review-spec', name: 'Spec review', deps: [], parentId: 'review', agent: 'claude', start: 10, end: 11 },
    { id: 'pr', name: 'Open the PR (/pr)', deps: ['review'], agent: 'claude', start: 13, end: 15 },
]
const GATE = { id: 'gate', taskId: 'scope', question: 'Throw, or require an explicit user?', resolveAt: 3, resolution: 'throw' }
const CYCLE_STEPS = Math.max(...TIMELINE.map((entry) => entry.end)) + HOLD_STEPS

function statusAt(entry, step, gateOpen) {
    if (step >= entry.end) {
        return 'completed'
    }
    if (step >= entry.start) {
        return 'dispatched'
    }
    if (gateOpen && entry.id === GATE.taskId) {
        return 'blocked'
    }
    const depsDone = entry.deps.every((depId) => step >= TIMELINE.find((other) => other.id === depId).end)
    const parentStarted = !entry.parentId || step >= TIMELINE.find((other) => other.id === entry.parentId).start

    return depsDone && parentStarted ? 'ready' : 'pending'
}

export function demoGraph(now) {
    const elapsed = now - DEMO_EPOCH
    const cycleStart = DEMO_EPOCH + Math.floor(elapsed / (CYCLE_STEPS * STEP_MS)) * CYCLE_STEPS * STEP_MS
    const step = Math.floor((now - cycleStart) / STEP_MS)
    const at = (stepIndex) => new Date(cycleStart + stepIndex * STEP_MS).toISOString()
    const gateOpen = step < GATE.resolveAt

    const tasks = TIMELINE.map((entry) => {
        const status = statusAt(entry, step, gateOpen)

        return {
            id: entry.id,
            name: entry.name,
            spec: `Demo task: ${entry.name}.`,
            status,
            deps: entry.deps,
            parentId: entry.parentId ?? null,
            outcome: status === 'completed' ? 'succeeded' : null,
            createdAt: at(0),
            completedAt: status === 'completed' ? at(entry.end) : null,
            agent: status === 'pending' || status === 'ready' ? null : entry.agent,
            terminal: null,
            worktreeId: null,
        }
    })
    const gates = [
        {
            id: GATE.id,
            taskId: GATE.taskId,
            question: GATE.question,
            status: gateOpen ? 'pending' : 'resolved',
            resolution: gateOpen ? null : GATE.resolution,
        },
    ]

    return { run: { ...DEMO_RUN, createdAt: at(0) }, tasks, gates }
}
