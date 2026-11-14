import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join, posix } from 'node:path'
import { fileURLToPath } from 'node:url'
import { orcaCli } from './orca-cli.mjs'

export const FACTORY_ERROR_CODES = Object.freeze({
    notInWsl: 'factory_not_in_wsl',
    cliFailed: 'factory_cli_failed',
    workspaceNotFound: 'factory_workspace_not_found',
    unknownTerminalCommand: 'factory_unknown_terminal_command',
})

/** The `factory` commands a ticket's terminal can run, and the terminal title for each. */
const TERMINAL_COMMANDS = Object.freeze({
    watch: (issueNumber) => `watch #${issueNumber}`,
    resume: (issueNumber) => `resume #${issueNumber}`,
})

const CONFIG_FILE = '.factory.json'
const FACTORY_WORKTREE_PATTERN = /-factory[\\/]issue-\d+$/
const WSL_UNC_PATTERN = /^\\\\wsl(?:\.localhost|\$)\\([^\\]+)(\\.*)?$/i
const CLI_TIMEOUT_MS = 60000
const GITHUB_REFRESH_MS = 60000
const REPOS_REFRESH_MS = 5 * 60000

const factoryError = (code, message) => Object.assign(new Error(message), { code })
const shellQuote = (value) => `'${String(value).replaceAll("'", "'\\''")}'`

/** `\\wsl.localhost\<distro>\home\…` → `{ distro, path: '/home/…' }`, or null for a Windows path. */
function wslLocation(uncPath) {
    const match = WSL_UNC_PATTERN.exec(uncPath)

    return match ? { distro: match[1], path: (match[2] ?? '\\').replaceAll('\\', '/') } : null
}

/** The factory CLI ships in the same repo as this plugin: <repo>/factory/bin/factory.mjs. */
function factoryCli() {
    const location = wslLocation(fileURLToPath(new URL('..', import.meta.url)).replace(/\\$/, ''))
    if (!location) {
        throw factoryError(FACTORY_ERROR_CODES.notInWsl, 'The factory view needs the plugin loaded from a WSL folder')
    }

    return { distro: location.distro, path: posix.join(location.path, '..', '..', 'factory', 'bin', 'factory.mjs') }
}

function wsl(distro, args) {
    const wslExe = join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'wsl.exe')

    return new Promise((resolve, reject) => {
        execFile(wslExe, ['-d', distro, '--', ...args], { windowsHide: true, timeout: CLI_TIMEOUT_MS, maxBuffer: 16 * 1024 * 1024 }, (error, stdout, stderr) => {
            if (error) {
                reject(factoryError(FACTORY_ERROR_CODES.cliFailed, stderr.trim() || error.message))
                return
            }
            resolve(stdout)
        })
    })
}

/**
 * Creates the worker side of the Factory panel: finds repos with a .factory.json among Orca's workspaces,
 * runs `factory status --json` in WSL (GitHub at most once a minute, local runs on every poll),
 * and opens a ticket's worktree or a run log in Orca.
 */
export function createFactorySource(orca) {
    const nodeByDistro = new Map()
    const githubStateByRoot = new Map()
    let repos = { at: 0, list: [] }

    /** nvm puts node on PATH only in an interactive shell, so ask one once and call node directly after. */
    async function nodePath(distro) {
        if (!nodeByDistro.has(distro)) {
            const output = await wsl(distro, ['sh', '-c', 'exec "${SHELL:-sh}" -ic "command -v node"'])
            nodeByDistro.set(distro, output.trim().split('\n').at(-1).trim())
        }

        return nodeByDistro.get(distro)
    }

    async function factoryStatus(repo, extraArgs) {
        const cli = factoryCli()
        const output = await wsl(repo.distro, [await nodePath(repo.distro), cli.path, 'status', '--json', '--repo', repo.root, ...extraArgs])

        return JSON.parse(output)
    }

    async function workspaces() {
        return (await orca.host.call('workspace.list', {})).workspaces
    }

    async function factoryRepos() {
        if (Date.now() - repos.at < REPOS_REFRESH_MS) {
            return repos.list
        }
        const found = new Map()
        for (const workspace of await workspaces()) {
            const location = wslLocation(workspace.path)
            if (workspace.kind !== 'worktree' || !location || FACTORY_WORKTREE_PATTERN.test(workspace.path) || !existsSync(join(workspace.path, CONFIG_FILE))) {
                continue
            }
            found.set(location.path, { name: workspace.project ?? workspace.name, root: location.path, distro: location.distro })
        }
        repos = { at: Date.now(), list: [...found.values()] }

        return repos.list
    }

    async function githubState(repo) {
        const cached = githubStateByRoot.get(repo.root)
        if (cached && Date.now() - cached.at < GITHUB_REFRESH_MS) {
            return cached.state
        }
        const state = await factoryStatus(repo, [])
        githubStateByRoot.set(repo.root, { at: Date.now(), state })

        return state
    }

    async function getFactory(input) {
        const list = await factoryRepos()
        const repo = list.find((candidate) => candidate.root === input?.root) ?? list[0]
        const repoSummaries = list.map(({ name, root: repoRoot }) => ({ name, root: repoRoot }))
        if (!repo) {
            return { repos: repoSummaries, repo: null, tickets: [] }
        }

        const [state, local] = await Promise.all([githubState(repo), factoryStatus(repo, ['--local'])])

        return {
            repos: repoSummaries,
            repo: { name: repo.name, root: repo.root },
            tickets: state.tickets.map((ticket) => ({ ...ticket, run: local.runs[ticket.number] ?? ticket.run })),
            githubCheckedAt: new Date(githubStateByRoot.get(repo.root).at).toISOString(),
        }
    }

    async function workspaceAt(linuxPath) {
        const workspace = (await workspaces()).find((candidate) => wslLocation(candidate.path)?.path === linuxPath)
        if (!workspace) {
            throw factoryError(FACTORY_ERROR_CODES.workspaceNotFound, `Orca shows no workspace at ${linuxPath}`)
        }

        return workspace
    }

    async function openWorktree({ worktree }) {
        const workspace = await workspaceAt(worktree)
        await orca.host.call('workspace.open', { workspaceId: workspace.id })

        return { opened: workspace.name }
    }

    async function openLog({ root, log }) {
        const workspace = await workspaceAt(root)
        await orca.host.call('editor.open', { workspaceId: workspace.id, path: log })

        return { opened: log }
    }

    /**
     * Opens a terminal tab in the ticket's worktree running `factory watch` or `factory resume`, and switches to it.
     * Through the CLI: the plugin API's terminal.create only makes a background terminal with no tab.
     */
    async function openTerminal({ root, worktree, issueNumber, command }) {
        const title = TERMINAL_COMMANDS[command]?.(issueNumber)
        if (!title) {
            throw factoryError(FACTORY_ERROR_CODES.unknownTerminalCommand, `No factory terminal command "${command}"`)
        }
        const repo = (await factoryRepos()).find((candidate) => candidate.root === root)
        const workspace = await workspaceAt(worktree)
        const commandLine = [await nodePath(repo?.distro ?? factoryCli().distro), factoryCli().path, command, issueNumber, '--repo', root].map(shellQuote).join(' ')
        const { terminal } = await orcaCli(['terminal', 'create', '--worktree', workspace.id, '--title', title, '--command', commandLine, '--focus'])

        return { terminal: terminal.handle }
    }

    return { getFactory, openWorktree, openLog, openTerminal }
}
