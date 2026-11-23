import { existsSync } from 'node:fs'
import { basename } from 'node:path'
import { STATUS_CACHE, factoryState } from './github.mjs'
import { issuesWithRuns, latestRun } from './progress.mjs'
import { readStack } from './stack.mjs'
import { worktreePathFor } from './worktree.mjs'

async function latestRuns(repo) {
    const issueNumbers = await issuesWithRuns(repo.gitDir)
    const runs = await Promise.all(issueNumbers.map(async (issueNumber) => [issueNumber, await latestRun({ root: repo.root, gitDir: repo.gitDir, issueNumber })]))

    return Object.fromEntries(runs.filter(([, run]) => run !== null))
}

export async function factoryStatus(repo, { local = false, cached = false } = {}) {
    const runs = await latestRuns(repo)
    const summary = { repo: basename(repo.root), root: repo.root, stack: await readStack(repo.gitDir) }
    if (local) {
        return { ...summary, runs }
    }

    const tickets = await factoryState({ cwd: repo.root, cache: cached ? STATUS_CACHE : null })

    return {
        ...summary,
        tickets: tickets.map((ticket) => {
            const worktree = worktreePathFor(repo.root, ticket.number)

            return { ...ticket, worktree: existsSync(worktree) ? worktree : null, run: runs[ticket.number] ?? null }
        }),
    }
}
