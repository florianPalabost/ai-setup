import { branchForIssue } from './constants.mjs'
import { mergedAgentPrs } from './github.mjs'
import { run } from './shell.mjs'
import { readStack } from './stack.mjs'
import { worktreePathFor } from './worktree.mjs'

const git = (args, { cwd }) => run('git', args, { cwd })

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

async function unmergedWorkReason(path, pr) {
    if ((await git(['status', '--porcelain'], { cwd: path })).trim() !== '') {
        return 'uncommitted changes'
    }
    const head = (await git(['rev-parse', 'HEAD'], { cwd: path })).trim()

    return head !== pr.headRefOid ? `commits after PR #${pr.number} merged` : null
}

/**
 * Removes the worktree and local branch of every ticket whose PR is merged.
 * Keeps a worktree with uncommitted changes, whose branch moved past the merged commit, or that has the stack.
 * @returns {Promise<{ removed: number[], kept: { issueNumber: number, reason: string }[] }>}
 */
export async function cleanMergedWorktrees({ repo, log, dryRun = false }) {
    const worktrees = await factoryWorktrees(repo.root)
    if (worktrees.length === 0) {
        return { removed: [], kept: [] }
    }

    const merged = await mergedAgentPrs(worktrees.map(({ issueNumber }) => branchForIssue(issueNumber)), { cwd: repo.root })
    const stack = await readStack(repo.gitDir)
    const removed = []
    const kept = []

    for (const { path, issueNumber } of worktrees) {
        const branch = branchForIssue(issueNumber)
        const pr = merged.get(branch)
        if (!pr) {
            continue
        }

        const reason = stack?.path === path ? 'stack is up' : await unmergedWorkReason(path, pr)
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

    return { removed, kept }
}
