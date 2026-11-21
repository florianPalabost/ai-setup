import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'
import { ERROR_CODES, FactoryError } from './constants.mjs'
import { run, succeeds } from './shell.mjs'

const git = (args, { cwd }) => run('git', args, { cwd })

/**
 * The main checkout's root and git dir, even when called from inside a worktree.
 * @returns {Promise<{ root: string, gitDir: string }>}
 */
export async function locateRepo(cwd) {
    let gitDir
    try {
        gitDir = (await git(['rev-parse', '--path-format=absolute', '--git-common-dir'], { cwd })).trim()
    } catch {
        throw new FactoryError(ERROR_CODES.notARepo, `${cwd} is not inside a git repository`)
    }

    return { root: dirname(gitDir), gitDir }
}

/** Worktrees live next to the repo, e.g. ~/dev/lara-vision-factory/issue-42. */
export const worktreePathFor = (root, issueNumber) => join(dirname(root), `${basename(root)}-factory`, `issue-${issueNumber}`)

const BASELINE_SHA_LENGTH = 12

/** The throwaway checkout the baseline checks run in, beside the tickets' worktrees. */
export const baselineWorktreePathFor = (root, sha) => join(dirname(root), `${basename(root)}-factory`, `baseline-${sha.slice(0, BASELINE_SHA_LENGTH)}`)

/** Fetches origin/<base> and returns the commit it points at. */
export async function fetchBase({ root, base }) {
    await git(['fetch', 'origin', base], { cwd: root })

    return (await git(['rev-parse', `origin/${base}`], { cwd: root })).trim()
}

export const removeWorktree = ({ root, path }) => git(['worktree', 'remove', '--force', path], { cwd: root })

/** A detached checkout of `ref`, replacing one a crashed run left at `path`. */
export async function addDetachedWorktree({ root, path, ref }) {
    if (existsSync(path)) {
        await removeWorktree({ root, path })
    }
    await git(['worktree', 'add', '--detach', path, ref], { cwd: root })
}

/**
 * Creates the ticket's worktree from origin/<base>, or reuses the existing one so a re-run continues the work.
 * @returns {Promise<{ created: boolean }>}
 */
export async function prepareWorktree({ root, path, branch, base }) {
    if (existsSync(path)) {
        return { created: false }
    }

    await git(['fetch', 'origin', base], { cwd: root })
    const branchExists = succeeds('git', ['show-ref', '--verify', '--quiet', `refs/heads/${branch}`], { cwd: root })
    const args = branchExists ? ['worktree', 'add', path, branch] : ['worktree', 'add', '-b', branch, path, `origin/${base}`]
    await git(args, { cwd: root })

    return { created: true }
}

export async function commitsAhead({ root, base, branch }) {
    return Number((await git(['rev-list', '--count', `origin/${base}..${branch}`], { cwd: root })).trim())
}

/**
 * Whether git can reach origin, asked on the terminal so ssh or a credential helper can prompt now,
 * while someone is there, rather than at the push an hour later.
 */
export const canReachOrigin = ({ root }) => spawnSync('git', ['ls-remote', '--exit-code', 'origin', 'HEAD'], { cwd: root, stdio: ['inherit', 'ignore', 'inherit'] }).status === 0

export const pushBranch = ({ root, branch }) => git(['push', '-u', 'origin', branch], { cwd: root })
