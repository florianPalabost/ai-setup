import { existsSync } from 'node:fs'
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { ERROR_CODES, FactoryError } from './constants.mjs'
import { latestRun } from './progress.mjs'
import { runShellCommand, runUntilInterrupted } from './shell.mjs'
import { worktreePathFor } from './worktree.mjs'

export const MAIN_CHECKOUT = 'main'

const stackFile = (gitDir) => join(gitDir, 'factory', 'stack.json')

/**
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
    await runUntilInterrupted(config.serve, { cwd: target.path, key: 'serve' })
    log(`serve stopped; stack still up in ${checkoutLabel(target.checkout)} (factory down to stop it)`)
}

export async function stackDown({ repo, config, log }) {
    requireStackConfig(config, ['down'])
    const current = await readStack(repo.gitDir)
    await runCommands('down', config.down, { cwd: downCheckoutPath(repo, current, log), log })
    await rm(stackFile(repo.gitDir), { force: true })
    log('stack down')
}
