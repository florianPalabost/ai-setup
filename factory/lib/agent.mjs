import { createWriteStream } from 'node:fs'
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

const parseJsonLine = (line) => {
    try {
        return JSON.parse(line)
    } catch {
        return null
    }
}

/**
 * The `result` event of a stream-json transcript, or null when the run never finished one.
 * A session woken by background work emits one result per wake-up, and the last may carry no
 * structured output; with a schema, the last result that has one is the answer.
 */
const resultEvent = (stdout, { wantsStructuredOutput }) => {
    const results = stdout.trimEnd().split('\n').map(parseJsonLine).filter((event) => event?.type === 'result')
    const structured = wantsStructuredOutput ? results.findLast((event) => event.structured_output != null) : undefined

    return structured ?? results.at(-1) ?? null
}

/** An agent step's transcript file in the run directory. */
export const agentLogName = (step) => `${step}.jsonl`

const closeStream = (stream) => new Promise((resolve) => stream.end(resolve))

/**
 * One headless Claude run, optionally wrapped in srt. The prompt goes in on stdin.
 * The transcript streams to `logPath` as JSON lines while the run works, so `factory status` can show what it is doing.
 * Sessions persist, so `claude --resume <sessionId>` from the worktree replays a run.
 * @returns {Promise<{ result: string, structuredOutput: unknown, costUsd: number|null, sessionId: string|null }>}
 */
export async function runClaude({ cwd, prompt, model, permissionMode, allowedTools, jsonSchema, settingsPath, timeoutMinutes, logPath }) {
    const claudeArgs = ['-p', '--output-format', 'stream-json', '--verbose', '--model', model, '--permission-mode', permissionMode, '--permission-prompts', 'none']
    if (allowedTools?.length) {
        claudeArgs.push('--allowedTools', ...allowedTools)
    }
    if (jsonSchema) {
        claudeArgs.push('--json-schema', JSON.stringify(jsonSchema))
    }

    const [command, args] = settingsPath ? ['srt', ['--settings', settingsPath, '--', 'claude', ...claudeArgs]] : ['claude', claudeArgs]

    const log = createWriteStream(logPath)
    let stdout
    try {
        stdout = await run(command, args, { cwd, input: prompt, timeoutMs: timeoutMinutes * 60_000, onStdout: (chunk) => log.write(chunk) })
    } catch (error) {
        log.write(`\n${error.message}\n${error.stderr ?? ''}`)
        await closeStream(log)
        throw new FactoryError(ERROR_CODES.agentFailed, `claude run failed (log: ${logPath}): ${error.message}`)
    }
    await closeStream(log)

    const output = resultEvent(stdout, { wantsStructuredOutput: Boolean(jsonSchema) })
    if (!output) {
        throw new FactoryError(ERROR_CODES.agentFailed, `claude returned no result event (log: ${logPath})`)
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
