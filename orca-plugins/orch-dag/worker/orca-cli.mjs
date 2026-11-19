import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'

export const ORCA_CLI_ERROR_CODES = Object.freeze({
    failed: 'cli_failed',
})

const CLI_TIMEOUT_MS = 20000

/** On Linux and macOS the CLI is `orca-ide`: a bare `orca` there can be GNOME's screen reader. */
function orcaCliPath() {
    const candidates = process.platform === 'win32'
        ? [
            join(dirname(process.execPath), 'resources', 'bin', 'orca.exe'),
            process.env.USERPROFILE && join(process.env.USERPROFILE, 'AppData', 'Local', 'Programs', 'orca', 'resources', 'bin', 'orca.exe'),
        ]
        : [
            join(dirname(process.execPath), 'resources', 'bin', 'orca-ide'),
            join(dirname(process.execPath), '..', 'Resources', 'bin', 'orca-ide'),
            '/opt/Orca/resources/bin/orca-ide',
            '/usr/bin/orca-ide',
        ]
    const existing = candidates.filter(Boolean)

    return existing.find((candidate) => existsSync(candidate)) ?? (process.platform === 'win32' ? existing[0] : 'orca-ide')
}

/** The worker's environment is filtered and drops APPDATA, which the CLI needs to find the runtime. */
function cliEnv() {
    const env = { ...process.env }
    if (!env.APPDATA && env.USERPROFILE) {
        env.APPDATA = join(env.USERPROFILE, 'AppData', 'Roaming')
    }

    return env
}

/** Runs the Orca CLI with --json and resolves with its `result`, for what the plugin API can't do. */
export function orcaCli(args) {
    return new Promise((resolve, reject) => {
        execFile(orcaCliPath(), [...args, '--json'], { env: cliEnv(), windowsHide: true, timeout: CLI_TIMEOUT_MS }, (error, stdout, stderr) => {
            let response
            try {
                response = JSON.parse(stdout)
            } catch {
                reject(Object.assign(new Error(stderr || error?.message || 'orca CLI returned no JSON'), { code: ORCA_CLI_ERROR_CODES.failed }))
                return
            }
            if (!response.ok) {
                reject(Object.assign(new Error(response.error?.message ?? 'orca CLI failed'), { code: response.error?.code ?? ORCA_CLI_ERROR_CODES.failed }))
                return
            }
            resolve(response.result)
        })
    })
}
