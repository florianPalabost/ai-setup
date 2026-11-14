import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'

const CLI_TIMEOUT_MS = 20000

function orcaCliPath() {
    const candidates = [
        join(dirname(process.execPath), 'resources', 'bin', 'orca.exe'),
        process.env.USERPROFILE && join(process.env.USERPROFILE, 'AppData', 'Local', 'Programs', 'orca', 'resources', 'bin', 'orca.exe'),
    ].filter(Boolean)

    return candidates.find((candidate) => existsSync(candidate)) ?? candidates[0]
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
                reject(Object.assign(new Error(stderr || error?.message || 'orca CLI returned no JSON'), { code: 'cli_failed' }))
                return
            }
            if (!response.ok) {
                reject(Object.assign(new Error(response.error?.message ?? 'orca CLI failed'), { code: response.error?.code ?? 'cli_failed' }))
                return
            }
            resolve(response.result)
        })
    })
}
