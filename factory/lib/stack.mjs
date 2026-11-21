import { existsSync } from 'node:fs'
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { ERROR_CODES, FactoryError } from './constants.mjs'
import { latestRun } from './progress.mjs'
import { runForegroundCommand, runShellCommand } from './shell.mjs'
import { worktreePathFor } from './worktree.mjs'

export const MAIN_CHECKOUT = 'main'

const stackFile = (gitDir) => join(gitDir, 'factory', 'stack.json')

/**
 * The checkout the stack was last started in, or null when factory has no record of it.
 * @returns {Promise<null | { checkout: 'main' | number, path: string, since: string }>}
 */
export async function readStack(gitDir) {
    const path = stackFile(gitDir)

    return existsSync(path) ? JSON.parse(await readFile(path, 'utf8')) : null
}

async function writeStack(gitDir, stack) {
    await mkdir(join(gitDir, 'factory'), { recursive: true })
    await writeFile(stackFile(gitDir), `${JSON.stringify(stack, null, 2)}\n`)
}

export const checkoutLabel = (checkout) => (checkout === MAIN_CHECKOUT ? MAIN_CHECKOUT : `#${checkout}`)

/** What's wrong with the up / down / serve keys of a config, one sentence per problem. */
export function stackConfigProblems(config) {
    const problems = []
    if ((config.up.length === 0) !== (config.down.length === 0)) {
        problems.push('up and down must be both set or both empty')
    }
    if (config.serve && config.up.length === 0) {
        problems.push('serve is set without up')
    }

    return problems
}

function requireStackConfig(config, keys) {
    const empty = keys.filter((key) => config[key].length === 0)
    if (empty.length > 0) {
        throw new FactoryError(ERROR_CODES.stackNotConfigured, `set ${empty.join(' and ')} in .factory.json to start and stop the stack`)
    }
}

async function runCommands(key, commands, { cwd, log }) {
    for (const command of commands) {
        log(`${key}: ${command}`)
        await runShellCommand(command, { cwd, key })
    }
}

/** The checkout to run `down` in: the recorded one, or the main checkout when there's no record or it's gone. */
function downCheckoutPath(repo, stack, log) {
    if (!stack) {
        return repo.root
    }
    if (!existsSync(stack.path)) {
        log(`warning: ${stack.path} (${checkoutLabel(stack.checkout)}) is gone; running down from the main checkout`)

        return repo.root
    }

    return stack.path
}

function targetCheckout(repo, checkout) {
    if (checkout === MAIN_CHECKOUT) {
        return { checkout, path: repo.root }
    }
    const path = worktreePathFor(repo.root, checkout)
    if (!existsSync(path)) {
        throw new FactoryError(ERROR_CODES.noWorktree, `#${checkout} has no worktree at ${path} (factory run ${checkout} creates it)`)
    }

    return { checkout, path }
}

async function warnIfRunWorking(repo, checkout, log) {
    if (checkout === MAIN_CHECKOUT) {
        return
    }
    const run = await latestRun({ root: repo.root, gitDir: repo.gitDir, issueNumber: checkout })
    if (run && !run.finishedAt) {
        log(`warning: a run is working in #${checkout}; its checks may clash with the stack`)
    }
}

/**
 * Moves the repo's single stack to a checkout: `down` where it is now, `up` in the new one, then `serve` in the
 * foreground. stack.json points at the new checkout before `up` runs, so `factory down` can clean up a failed `up`.
 */
export async function stackUp({ repo, config, checkout, serve, force, log }) {
    requireStackConfig(config, ['up', 'down'])
    const target = targetCheckout(repo, checkout)
    await warnIfRunWorking(repo, checkout, log)

    const current = await readStack(repo.gitDir)
    if ((current?.checkout ?? MAIN_CHECKOUT) === target.checkout) {
        log(`stack already up in ${checkoutLabel(target.checkout)}: running up again`)
    } else {
        const downPath = downCheckoutPath(repo, current, log)
        try {
            await runCommands('down', config.down, { cwd: downPath, log })
        } catch (error) {
            if (!force) {
                throw error
            }
            log(`warning: ${error.message}; carrying on (--force)`)
        }
    }

    await writeStack(repo.gitDir, { ...target, since: new Date().toISOString() })
    await runCommands('up', config.up, { cwd: target.path, log })
    log(`stack up in ${checkoutLabel(target.checkout)}`)

    if (!serve || !config.serve) {
        return
    }
    log(`serve: ${config.serve}`)
    await runForegroundCommand(config.serve, { cwd: target.path, key: 'serve' })
    log(`serve stopped; stack still up in ${checkoutLabel(target.checkout)} (factory down to stop it)`)
}

/** Runs `down` where the stack is up (the main checkout with no record) and forgets it. */
export async function stackDown({ repo, config, log }) {
    requireStackConfig(config, ['down'])
    const current = await readStack(repo.gitDir)
    await runCommands('down', config.down, { cwd: downCheckoutPath(repo, current, log), log })
    await rm(stackFile(repo.gitDir), { force: true })
    log('stack down')
}
