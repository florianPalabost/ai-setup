import { DEMO_RUN, DEMO_RUN_ID, demoRun } from './demo.mjs'

const RUN_OUTCOMES = Object.freeze({
    'agent-done': 'draft PR open',
    'ready-for-human': 'handed to you',
    error: 'stopped on an error',
    abandoned: 'stopped without finishing',
})

// A ticket's worktree, e.g. ~/dev/lara-vision-factory/issue-42, or a folder inside it.
const ISSUE_WORKTREE_PATTERN = /-factory[\\/]issue-(\d+)(?:[\\/]|$)/

export const issueOfFolder = (folder) => ISSUE_WORKTREE_PATTERN.exec(folder ?? '')?.[1] ?? null

function objectiveOf(issueNumber, run) {
    const state = run.outcome ? RUN_OUTCOMES[run.outcome] ?? run.outcome : run.finishedAt ? 'ended' : 'running'

    return `#${issueNumber} · ${state}`
}

/**
 * One factory run shaped for drawing, from `factory status --json --local`: each step a card after the one before it.
 * Picks `runId` (an issue number, or the demo), else the ticket whose worktree `folder` is in, else the newest run.
 * Imports nothing from herdr, so node can test it.
 */
export function runGraph(status, { runId = null, folder = null, now = Date.now() } = {}) {
    const runs = Object.entries(status?.runs ?? {})
        .map(([issueNumber, run]) => ({ id: issueNumber, objective: objectiveOf(issueNumber, run), run }))
        .sort((left, right) => (right.run.startedAt ?? '').localeCompare(left.run.startedAt ?? ''))
    const summary = [...runs.map(({ id, objective }) => ({ id, objective })), DEMO_RUN]
    const picked = runId === DEMO_RUN_ID
        ? { ...DEMO_RUN, run: demoRun(now) }
        : runs.find((run) => run.id === runId) ?? runs.find((run) => run.id === issueOfFolder(folder)) ?? runs[0]
    if (!picked) {
        return { repo: status?.repo ?? null, runs: summary, run: null, steps: [] }
    }

    const { run } = picked
    const steps = run.steps.map((step, index) => ({
        id: `step:${step.name}`,
        name: step.name,
        status: step.status,
        deps: index === 0 ? [] : [`step:${run.steps[index - 1].name}`],
        detail: step.detail ?? null,
        agent: step.sessionId ? 'claude' : null,
        startedAt: step.startedAt,
        endedAt: step.status === 'running' ? null : step.updatedAt,
    }))

    return {
        repo: status?.repo ?? null,
        runs: summary,
        run: { id: picked.id, objective: picked.objective, outcome: run.outcome, startedAt: run.startedAt, finishedAt: run.finishedAt },
        steps,
    }
}
