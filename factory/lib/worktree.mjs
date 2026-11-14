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

export const pushBranch = ({ root, branch }) => git(['push', '-u', 'origin', branch], { cwd: root })
