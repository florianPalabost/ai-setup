import { spawn, spawnSync } from 'node:child_process'
import { ERROR_CODES, FactoryError } from './constants.mjs'

/**
 * Runs a program without a shell and resolves with its stdout.
 * Rejects with a FactoryError carrying stderr when it exits non-zero or times out.
 * `onStdout` sees each chunk as it arrives, for logs that must be readable while the program runs.
 */
export function run(command, args, { cwd, input, timeoutMs, onStdout } = {}) {
    return new Promise((resolve, reject) => {
        const child = spawn(command, args, { cwd, stdio: [input === undefined ? 'ignore' : 'pipe', 'pipe', 'pipe'] })
        let stdout = ''
        let stderr = ''
        let timedOut = false
        const timer = timeoutMs
            ? setTimeout(() => {
                timedOut = true
                child.kill('SIGTERM')
            }, timeoutMs)
            : null

        child.stdout.on('data', (chunk) => {
            stdout += chunk
            onStdout?.(chunk)
        })
        child.stderr.on('data', (chunk) => {
            stderr += chunk
        })
        child.on('error', (error) => {
            clearTimeout(timer)
            reject(new FactoryError(ERROR_CODES.commandFailed, `${command}: ${error.message}`))
        })
        child.on('close', (exitCode) => {
            clearTimeout(timer)
            if (timedOut) {
                reject(new FactoryError(ERROR_CODES.commandFailed, `${command} timed out after ${Math.round(timeoutMs / 60000)} min`))
                return
            }
            if (exitCode !== 0) {
                reject(Object.assign(new FactoryError(ERROR_CODES.commandFailed, `${command} ${args.slice(0, 3).join(' ')} exited ${exitCode}: ${stderr.trim() || stdout.trim().slice(-500)}`), { stdout, stderr }))
                return
            }
            resolve(stdout)
        })

        if (input !== undefined) {
            child.stdin.on('error', () => {})
            child.stdin.end(input)
        }
    })
}

const commandFailed = (key, exitCode, commandLine) => new FactoryError(ERROR_CODES.commandFailed, `${key} command failed (exit ${exitCode}): ${commandLine}`)

/** Runs a command from the `key` list of .factory.json through sh, streaming its output to the terminal. */
export function runShellCommand(commandLine, { cwd, key }) {
    return new Promise((resolve, reject) => {
        const child = spawn('sh', ['-c', commandLine], { cwd, stdio: ['ignore', 'inherit', 'inherit'] })
        child.on('error', (error) => reject(new FactoryError(ERROR_CODES.commandFailed, `${commandLine}: ${error.message}`)))
        child.on('close', (exitCode) => {
            if (exitCode !== 0) {
                reject(commandFailed(key, exitCode, commandLine))
                return
            }
            resolve()
        })
    })
}

/**
 * Runs a long-running command through sh with the terminal attached, until it ends or Ctrl+C stops it.
 * Ctrl+C reaches the command, while factory ignores it and resolves, so the caller can carry on after it.
 */
export function runForegroundCommand(commandLine, { cwd, key }) {
    return new Promise((resolve, reject) => {
        let interrupted = false
        const onInterrupt = () => {
            interrupted = true
        }
        process.on('SIGINT', onInterrupt)
        const child = spawn('sh', ['-c', commandLine], { cwd, stdio: 'inherit' })
        child.on('error', (error) => {
            process.off('SIGINT', onInterrupt)
            reject(new FactoryError(ERROR_CODES.commandFailed, `${commandLine}: ${error.message}`))
        })
        child.on('close', (exitCode) => {
            process.off('SIGINT', onInterrupt)
            if (exitCode !== 0 && !interrupted) {
                reject(commandFailed(key, exitCode, commandLine))
                return
            }
            resolve()
        })
    })
}

/** How long a timed-out check gets to stop after SIGTERM before SIGKILL. */
const CHECK_KILL_GRACE_MS = 5000

/** Signals the check's whole process group; the group may already be gone. */
function signalGroup(child, signal) {
    try {
        process.kill(-child.pid, signal)
    } catch {}
}

/**
 * Runs a repo-configured check command through sh, in its own process group, and never rejects on a
 * non-zero exit. Past `timeoutMs` the group is killed and the check fails. Processes the check leaves
 * behind are killed when sh exits, since one holding the output pipe would keep it from ever closing.
 * @returns {Promise<{ passed: boolean, output: string }>}
 */
export function runCheckCommand(commandLine, { cwd, timeoutMs }) {
    return new Promise((resolve, reject) => {
        const child = spawn('sh', ['-c', commandLine], { cwd, stdio: ['ignore', 'pipe', 'pipe'], detached: true })
        let output = ''
        let timedOut = false
        let killTimer = null
        const timer = setTimeout(() => {
            timedOut = true
            signalGroup(child, 'SIGTERM')
            killTimer = setTimeout(() => signalGroup(child, 'SIGKILL'), CHECK_KILL_GRACE_MS)
        }, timeoutMs)
        child.stdout.on('data', (chunk) => {
            output += chunk
        })
        child.stderr.on('data', (chunk) => {
            output += chunk
        })
        child.on('error', (error) => {
            clearTimeout(timer)
            reject(new FactoryError(ERROR_CODES.commandFailed, `${commandLine}: ${error.message}`))
        })
        child.on('exit', () => signalGroup(child, 'SIGKILL'))
        child.on('close', (exitCode) => {
            clearTimeout(timer)
            clearTimeout(killTimer)
            if (timedOut) {
                resolve({ passed: false, output: `${output}\n[factory] timed out after ${Math.round(timeoutMs / 60000)} min` })
                return
            }
            resolve({ passed: exitCode === 0, output })
        })
    })
}

export function succeeds(command, args, { cwd } = {}) {
    return spawnSync(command, args, { cwd, stdio: 'ignore' }).status === 0
}

export const hasCommand = (name) => succeeds('sh', ['-c', `command -v ${name}`])
