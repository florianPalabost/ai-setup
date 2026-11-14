import { writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { ERROR_CODES, FactoryError } from './constants.mjs'
import { run } from './shell.mjs'

/** Domains the Claude CLI needs for the model API and for OAuth token refresh on a subscription login. */
const ANTHROPIC_DOMAINS = ['api.anthropic.com', 'claude.ai', 'platform.claude.com']

const SECRET_PATHS = ['~/.ssh', '~/.config/gh', '~/.git-credentials', '~/.aws', '~/.docker', '~/.gnupg', '~/.composer/auth.json', '~/.config/composer/auth.json', '/mnt/c']

/**
 * srt settings for one run: writes only to the worktree, the shared git dir (minus the files that
 * make git run programs on the host) and Claude's own login, and no network but Anthropic's.
 */
export function sandboxSettings({ worktreePath, gitDir, extraAllowWrite = [], extraDenyRead = [] }) {
    const home = homedir()

    return {
        filesystem: {
            denyRead: [...SECRET_PATHS, ...extraDenyRead],
            allowWrite: [worktreePath, gitDir, join(home, '.claude'), join(home, '.claude.json'), '/tmp', ...extraAllowWrite],
            denyWrite: [join(gitDir, 'hooks'), join(gitDir, 'config'), join(gitDir, 'info')],
        },
        network: {
            allowedDomains: ANTHROPIC_DOMAINS,
            deniedDomains: [],
        },
    }
}

export async function writeSandboxSettings(path, settings) {
    await writeFile(path, `${JSON.stringify(settings, null, 2)}\n`)
}

/**
 * One headless Claude run, optionally wrapped in srt. The prompt goes in on stdin.
 * Sessions persist, so `claude --resume <sessionId>` from the worktree replays a run.
 * @returns {Promise<{ result: string, structuredOutput: unknown, costUsd: number|null, sessionId: string|null }>}
 */
export async function runClaude({ cwd, prompt, model, permissionMode, allowedTools, jsonSchema, settingsPath, timeoutMinutes, logPath }) {
    const claudeArgs = ['-p', '--output-format', 'json', '--model', model, '--permission-mode', permissionMode, '--permission-prompts', 'none']
    if (allowedTools?.length) {
        claudeArgs.push('--allowedTools', ...allowedTools)
    }
    if (jsonSchema) {
        claudeArgs.push('--json-schema', JSON.stringify(jsonSchema))
    }

    const [command, args] = settingsPath ? ['srt', ['--settings', settingsPath, '--', 'claude', ...claudeArgs]] : ['claude', claudeArgs]

    let stdout
    try {
        stdout = await run(command, args, { cwd, input: prompt, timeoutMs: timeoutMinutes * 60_000 })
    } catch (error) {
        await writeFile(logPath, `${error.message}\n\n${error.stdout ?? ''}\n${error.stderr ?? ''}`)
        throw new FactoryError(ERROR_CODES.agentFailed, `claude run failed (log: ${logPath}): ${error.message}`)
    }
    await writeFile(logPath, stdout)

    let output
    try {
        output = JSON.parse(stdout)
    } catch {
        throw new FactoryError(ERROR_CODES.agentFailed, `claude returned no JSON (log: ${logPath})`)
    }
    if (output.is_error) {
        throw new FactoryError(ERROR_CODES.agentFailed, `claude reported an error (log: ${logPath}): ${output.result ?? output.subtype}`)
    }

    return {
        result: output.result ?? '',
        structuredOutput: output.structured_output ?? null,
        costUsd: output.total_cost_usd ?? null,
        sessionId: output.session_id ?? null,
    }
}
