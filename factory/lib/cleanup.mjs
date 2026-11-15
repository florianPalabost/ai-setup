import { basename } from 'node:path'
import { branchForIssue } from './constants.mjs'
import { mergedAgentPrs } from './github.mjs'
import { hasCommand, run } from './shell.mjs'
import { worktreePathFor } from './worktree.mjs'

const git = (args, { cwd }) => run('git', args, { cwd })

const ORCA_CLI = 'orca-ide'
const ORCA_VISIBILITY = Object.freeze({ show: 'show', hide: 'hide' })

const ISSUE_WORKTREE_PATTERN = /\/issue-(\d+)$/

/** The factory's worktrees, from `git worktree list`, with the issue each belongs to. */
async function factoryWorktrees(root) {
    const porcelain = await git(['worktree', 'list', '--porcelain'], { cwd: root })

    return porcelain
        .split('\n')
        .filter((line) => line.startsWith('worktree '))
        .map((line) => line.slice('worktree '.length))
        .map((path) => ({ path, issueNumber: Number(path.match(ISSUE_WORKTREE_PATTERN)?.[1]) }))
        .filter(({ path, issueNumber }) => issueNumber > 0 && path === worktreePathFor(root, issueNumber))
}

/**
 * Orca's sidebar keeps showing removed worktrees until the repo's external-worktree list is reloaded,
 * so hide and show them again. Only when they are shown, and never fatal: Orca is optional.
 */
async function refreshOrcaSidebar(root, log) {
    if (!hasCommand(ORCA_CLI)) {
        return
    }

    const repoSelector = `name:${basename(root)}`
    const setVisibility = (visibility) => run(ORCA_CLI, ['repo', 'set', '--repo', repoSelector, '--external-worktree-visibility', visibility])
    try {
        const { result } = JSON.parse(await run(ORCA_CLI, ['repo', 'show', '--repo', repoSelector, '--json']))
        if (result.repo.externalWorktreeVisibility !== ORCA_VISIBILITY.show) {
            return
        }
        await setVisibility(ORCA_VISIBILITY.hide)
        await setVisibility(ORCA_VISIBILITY.show)
        log('refreshed the Orca sidebar')
    } catch (error) {
        log(`could not refresh the Orca sidebar: ${error.message}`)
    }
}

/**
 * Removes the worktree and local branch of every ticket whose PR is merged.
 * Keeps a worktree with uncommitted changes, or whose branch moved past the merged commit.
 * @returns {Promise<{ removed: number[], kept: { issueNumber: number, reason: string }[] }>}
 */
export async function cleanMergedWorktrees({ repo, log, dryRun = false }) {
    const worktrees = await factoryWorktrees(repo.root)
    if (worktrees.length === 0) {
        return { removed: [], kept: [] }
    }

    const merged = await mergedAgentPrs({ cwd: repo.root })
    const removed = []
    const kept = []

    for (const { path, issueNumber } of worktrees) {
        const branch = branchForIssue(issueNumber)
        const pr = merged.get(branch)
        if (!pr) {
            continue
        }

        const dirty = (await git(['status', '--porcelain'], { cwd: path })).trim() !== ''
        const head = (await git(['rev-parse', 'HEAD'], { cwd: path })).trim()
        const reason = dirty ? 'uncommitted changes' : head !== pr.headRefOid ? `commits after PR #${pr.number} merged` : null
        if (reason) {
            kept.push({ issueNumber, reason })
            log(`keeping ${path}: ${reason}`)
            continue
        }

        log(`${dryRun ? 'would remove' : 'removing'} ${path} and ${branch} (PR #${pr.number} merged)`)
        if (!dryRun) {
            await git(['worktree', 'remove', '--force', path], { cwd: repo.root })
            await git(['branch', '-D', branch], { cwd: repo.root })
        }
        removed.push(issueNumber)
    }

    if (removed.length > 0 && !dryRun) {
        await refreshOrcaSidebar(repo.root, log)
    }

    return { removed, kept }
}
