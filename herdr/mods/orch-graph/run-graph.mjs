import { DEMO_RUN, DEMO_RUN_ID, demoGraph } from './demo.mjs'

const LEGACY_RUN_ID = 'run_legacy_local'

function parseJson(value, fallback) {
    if (typeof value !== 'string') {
        return value ?? fallback
    }
    try {
        return JSON.parse(value) ?? fallback
    } catch {
        return fallback
    }
}

/**
 * Reads one orchestration run (the newest when `runId` names none) with its tasks, gates and workers,
 * shaped for drawing. `orchestration(args)` runs `orca orchestration <args> --full --json` and resolves
 * with its result. Shared by the Orca plugin's worker and the herdr mod, so it imports nothing host-specific.
 */
export async function loadGraph(orchestration, { runId } = {}) {
    const runs = (await orchestration(['run-list'])).runs.filter((run) => run.id !== LEGACY_RUN_ID && !run.legacy)
    const summary = [...runs.map(({ id, objective }) => ({ id, objective })), DEMO_RUN]
    if (runId === DEMO_RUN_ID) {
        return { runs: summary, ...demoGraph(Date.now()) }
    }
    const run = runs.find((candidate) => candidate.id === runId) ?? runs[0]
    if (!run) {
        return { runs: summary, run: null, tasks: [], gates: [] }
    }

    const [taskResult, gateResult, workerResult] = await Promise.all([
        orchestration(['task-list', '--run', run.id]),
        orchestration(['gate-list', '--run', run.id]),
        orchestration(['worker-list', '--run', run.id]),
    ])

    const workerByTaskId = new Map()
    for (const worker of workerResult.workers) {
        if (!workerByTaskId.has(worker.taskId)) {
            workerByTaskId.set(worker.taskId, worker)
        }
    }

    const tasks = taskResult.tasks.map((task) => {
        const worker = workerByTaskId.get(task.id)

        return {
            id: task.id,
            name: task.display_name || task.task_title || task.id,
            spec: task.spec ?? '',
            status: task.status,
            deps: parseJson(task.deps, []),
            parentId: parseJson(task.parent_id, null),
            outcome: parseJson(task.result, {})?.outcome ?? null,
            createdAt: task.created_at,
            completedAt: task.completed_at,
            agent: worker?.projection?.provider?.id ?? null,
            terminal: worker?.agentTerminalHandle ?? null,
            worktreeId: worker?.resource?.worktreeId ?? worker?.projection?.workspace?.id ?? null,
        }
    })
    const gates = gateResult.gates.map((gate) => ({
        id: gate.id,
        taskId: gate.task_id,
        question: gate.question,
        status: gate.status ?? 'pending',
        resolution: gate.resolution ?? null,
    }))

    return { runs: summary, run: { id: run.id, objective: run.objective, createdAt: run.created_at }, tasks, gates }
}
