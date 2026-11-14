import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

export const CONFIG_FILE = '.factory.json'

const DEFAULTS = Object.freeze({
    baseBranch: 'main',
    setup: [],
    checks: [],
    standardsFile: 'CODING_STANDARDS.md',
    models: { implement: 'opus', review: 'sonnet', pr: 'sonnet' },
    permissionMode: 'auto',
    maxReworks: 2,
    agentTimeoutMinutes: 60,
    sandbox: { allowWrite: [], denyRead: [] },
})

/**
 * @returns {Promise<typeof DEFAULTS & { path: string|null }>}
 */
export async function loadConfig(repoRoot) {
    const path = join(repoRoot, CONFIG_FILE)
    if (!existsSync(path)) {
        return { ...DEFAULTS, path: null }
    }

    const fromFile = JSON.parse(await readFile(path, 'utf8'))

    return {
        ...DEFAULTS,
        ...fromFile,
        models: { ...DEFAULTS.models, ...fromFile.models },
        sandbox: { ...DEFAULTS.sandbox, ...fromFile.sandbox },
        path,
    }
}
