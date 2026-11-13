export const DEMO_RUN_ID = 'demo'
export const DEMO_RUN = { id: DEMO_RUN_ID, objective: 'Demo · sample data' }

const minutesAgo = (minutes) => new Date(Date.now() - minutes * 60000).toISOString()

function task(id, name, status, deps, agent, startedMinutesAgo, tookMinutes = null) {
    return {
        id,
        name,
        spec: `Demo task: ${name}.`,
        status,
        deps,
        createdAt: minutesAgo(startedMinutesAgo),
        completedAt: tookMinutes === null ? null : minutesAgo(startedMinutesAgo - tookMinutes),
        agent,
        terminal: null,
        worktreeId: null,
    }
}

export function demoGraph() {
    return {
        run: DEMO_RUN,
        tasks: [
            task('plan', 'Plan the invoice export', 'completed', [], 'claude', 95, 12),
            task('api', 'API endpoint for CSV and PDF export', 'dispatched', ['plan'], 'codex', 80),
            task('table', 'Invoice table component', 'ready', ['plan'], null, 80),
            task('ui', 'Export dialog UI', 'pending', ['api', 'table'], null, 80),
            task('tests', 'Feature tests', 'blocked', ['api', 'ui'], 'claude', 60),
            task('docs', 'Write the user docs', 'failed', ['plan'], 'codex', 70, 9),
            task('release', 'Release notes', 'pending', ['tests', 'docs'], null, 60),
        ],
        gates: [{ id: 'gate', taskId: 'tests', question: 'Use Pest browser tests for the export flow?' }],
    }
}
