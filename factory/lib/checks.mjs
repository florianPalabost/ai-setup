import { existsSync } from 'node:fs'
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { STEP_STATUSES } from './progress.mjs'
import { runCheckCommand, runShellCommand } from './shell.mjs'
import { addDetachedWorktree, baselineWorktreePathFor, fetchBase, removeWorktree } from './worktree.mjs'

const CHECK_OUTPUT_TAIL_LINES = 40

const tail = (text, lines) => text.trimEnd().split('\n').slice(-lines).join('\n')

/**
 * Runs the repo's checks on the host, so the factory never takes an agent's word that they pass.
 * @returns {Promise<{ command: string, finding: string }[]>} one entry per failing check
 */
export async function failingChecks({ checks, cwd, timeoutMs, runDir, attempt, log, progress, step }) {
    const failures = []
    for (const [index, command] of checks.entries()) {
        log(`check: ${command}`)
        await progress.record({ step, status: STEP_STATUSES.running, detail: command })
        const { passed, output } = await runCheckCommand(command, { cwd, timeoutMs })
        await writeFile(join(runDir, `checks-${attempt}-${index + 1}.log`), `$ ${command}\n\n${output}`)
        if (!passed) {
            failures.push({ command, finding: `Automated check \`${command}\` fails. Last lines of its output:\n\`\`\`\n${tail(output, CHECK_OUTPUT_TAIL_LINES)}\n\`\`\`` })
        }
    }

    return failures
}

export const baselineCachePath = (gitDir, sha) => join(gitDir, 'factory', `baseline-${sha}.json`)

/** The cached result for this base commit, unless the `checks` commands changed since. */
async function cachedBaseline(path, checks) {
    if (!existsSync(path)) {
        return null
    }
    const cached = JSON.parse(await readFile(path, 'utf8'))

    return JSON.stringify(cached.checks) === JSON.stringify(checks) ? cached : null
}

/**
 * The checks' result on origin/<base>, run once per base commit in a throwaway detached worktree (after the
 * `setup` commands) and cached in .git/factory, so a run can tell failures it caused from ones it inherited.
 * @returns {Promise<{ sha: string, checks: string[], failing: string[], runDir: string, cached: boolean }>}
 */
export async function baselineChecks({ repo, config, runDir, log, progress, step }) {
    const sha = await fetchBase({ root: repo.root, base: config.baseBranch })
    const cachePath = baselineCachePath(repo.gitDir, sha)
    const cached = await cachedBaseline(cachePath, config.checks)
    if (cached) {
        log(`baseline: origin/${config.baseBranch} (${sha.slice(0, 7)}) already checked`)

        return { ...cached, cached: true }
    }

    const path = baselineWorktreePathFor(repo.root, sha)
    log(`baseline: checking origin/${config.baseBranch} (${sha.slice(0, 7)}) in ${path}`)
    await addDetachedWorktree({ root: repo.root, path, ref: sha })
    let failures
    try {
        for (const command of config.setup) {
            log(`baseline setup: ${command}`)
            await progress.record({ step, status: STEP_STATUSES.running, detail: command })
            await runShellCommand(command, { cwd: path, key: 'setup' })
        }
        failures = await failingChecks({ checks: config.checks, cwd: path, timeoutMs: config.checkTimeoutMinutes * 60_000, runDir, attempt: 'baseline', log, progress, step })
    } finally {
        await removeWorktree({ root: repo.root, path })
    }

    const result = { sha, checks: config.checks, failing: failures.map(({ command }) => command), runDir, checkedAt: new Date().toISOString() }
    await writeFile(cachePath, `${JSON.stringify(result, null, 2)}\n`)

    return { ...result, cached: false }
}
