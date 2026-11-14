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

/** Runs a repo-configured setup command through sh, streaming its output to the terminal. */
export function runShellCommand(commandLine, { cwd }) {
    return new Promise((resolve, reject) => {
        const child = spawn('sh', ['-c', commandLine], { cwd, stdio: ['ignore', 'inherit', 'inherit'] })
        child.on('error', (error) => reject(new FactoryError(ERROR_CODES.commandFailed, `${commandLine}: ${error.message}`)))
        child.on('close', (exitCode) => {
            if (exitCode !== 0) {
                reject(new FactoryError(ERROR_CODES.commandFailed, `setup command failed (exit ${exitCode}): ${commandLine}`))
                return
            }
            resolve()
        })
    })
}

/**
 * Runs a repo-configured check command through sh and never rejects on a non-zero exit.
 * @returns {Promise<{ passed: boolean, output: string }>}
 */
export function runCheckCommand(commandLine, { cwd }) {
    return new Promise((resolve, reject) => {
        const child = spawn('sh', ['-c', commandLine], { cwd, stdio: ['ignore', 'pipe', 'pipe'] })
        let output = ''
        child.stdout.on('data', (chunk) => {
            output += chunk
        })
        child.stderr.on('data', (chunk) => {
            output += chunk
        })
        child.on('error', (error) => reject(new FactoryError(ERROR_CODES.commandFailed, `${commandLine}: ${error.message}`)))
        child.on('close', (exitCode) => resolve({ passed: exitCode === 0, output }))
    })
}

export function succeeds(command, args, { cwd } = {}) {
    return spawnSync(command, args, { cwd, stdio: 'ignore' }).status === 0
}

export const hasCommand = (name) => succeeds('sh', ['-c', `command -v ${name}`])
