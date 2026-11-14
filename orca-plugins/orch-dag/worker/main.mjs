import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { DEMO_RUN, DEMO_RUN_ID, demoGraph } from './demo.mjs'
import { createFactorySource } from './factory.mjs'

const LEGACY_RUN_ID = 'run_legacy_local'
const CLI_TIMEOUT_MS = 20000

function orcaCliPath() {
    const candidates = [
        join(dirname(process.execPath), 'resources', 'bin', 'orca.exe'),
        process.env.USERPROFILE && join(process.env.USERPROFILE, 'AppData', 'Local', 'Programs', 'orca', 'resources', 'bin', 'orca.exe'),
    ].filter(Boolean)

    return candidates.find((candidate) => existsSync(candidate)) ?? candidates[0]
}

/** The worker's environment is filtered and drops APPDATA, which the CLI needs to find the runtime. */
function cliEnv() {
    const env = { ...process.env }
    if (!env.APPDATA && env.USERPROFILE) {
        env.APPDATA = join(env.USERPROFILE, 'AppData', 'Roaming')
    }

    return env
}

function orchestration(args) {
    return new Promise((resolve, reject) => {
        execFile(orcaCliPath(), ['orchestration', ...args, '--json', '--full'], { env: cliEnv(), windowsHide: true, timeout: CLI_TIMEOUT_MS }, (error, stdout, stderr) => {
            let response
            try {
                response = JSON.parse(stdout)
            } catch {
                reject(Object.assign(new Error(stderr || error?.message || 'orca CLI returned no JSON'), { code: 'cli_failed' }))
                return
            }
            if (!response.ok) {
                reject(Object.assign(new Error(response.error?.message ?? 'orca CLI failed'), { code: response.error?.code ?? 'cli_failed' }))
                return
            }
            resolve(response.result)
        })
    })
}

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

async function loadGraph({ runId } = {}) {
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

async function openTask(orca, { terminal, worktreeId }) {
    if (terminal && orca.host.has('terminal.focus')) {
        await orca.host.call('terminal.focus', { terminalId: terminal })

        return { opened: 'terminal' }
    }
    if (worktreeId) {
        await orca.host.call('workspace.open', { workspaceId: worktreeId })

        return { opened: 'workspace' }
    }

    return { opened: null }
}

export default function activate(orca) {
    orca.panels.handle('graph.get', (input) => loadGraph(input))
    orca.panels.handle('task.open', (input) => openTask(orca, input))

    const factory = createFactorySource(orca)
    orca.panels.handle('factory.get', (input) => factory.getFactory(input))
    orca.panels.handle('factory.openWorktree', (input) => factory.openWorktree(input))
    orca.panels.handle('factory.openLog', (input) => factory.openLog(input))
}
