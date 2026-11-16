import { createFactorySource } from './factory.mjs'
import { orcaCli } from './orca-cli.mjs'
import { loadGraph } from './run-graph.mjs'

const orchestration = (args) => orcaCli(['orchestration', ...args, '--full'])

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
    orca.panels.handle('graph.get', (input) => loadGraph(orchestration, input))
    orca.panels.handle('task.open', (input) => openTask(orca, input))

    const factory = createFactorySource(orca)
    orca.panels.handle('factory.get', (input) => factory.getFactory(input))
    orca.panels.handle('factory.openWorktree', (input) => factory.openWorktree(input))
    orca.panels.handle('factory.openLog', (input) => factory.openLog(input))
    orca.panels.handle('factory.openTerminal', (input) => factory.openTerminal(input))
}
