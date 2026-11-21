#!/usr/bin/env node
import { existsSync, readFileSync, realpathSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { parseArgs } from 'node:util'
import { cleanMergedWorktrees } from '../lib/cleanup.mjs'
import { loadConfig } from '../lib/config.mjs'
import { ERROR_CODES, FACTORY_LABELS, FactoryError, LABELS } from '../lib/constants.mjs'
import { ensureFactoryLabels, listReadyIssues } from '../lib/github.mjs'
import { STEP_STATUSES } from '../lib/progress.mjs'
import { runTicket } from '../lib/run-ticket.mjs'
import { resumeSession, watchRun } from '../lib/session.mjs'
import { factoryStatus } from '../lib/status.mjs'
import { writeRunMarkdown } from '../lib/transcript.mjs'
import { hasCommand, succeeds } from '../lib/shell.mjs'
import { MAIN_CHECKOUT, checkoutLabel, stackConfigProblems, stackDown, stackUp } from '../lib/stack.mjs'
import { locateRepo } from '../lib/worktree.mjs'

const USAGE = `factory: run agent tickets from GitHub, one at a time

Usage:
  factory doctor                  check tools, gh login and the repo's .factory.json
  factory init                    create the ${FACTORY_LABELS.map((label) => label.name).join(' / ')} labels
  factory status [--json]         tickets the factory tracks, with their PRs and latest run
  factory run <issue> [options]   implement → review → draft PR for one ticket
  factory next [options]          run the oldest unblocked ${LABELS.ready} ticket
  factory watch <issue>           follow the ticket's latest run: steps and the agent's transcript
  factory resume <issue>          open Claude on the run's last coding session, in the worktree
  factory log <issue> [--json]    write the latest run as readable Markdown (run.md) and print its path
  factory clean [--dry-run] [--json] remove the worktrees and branches of tickets whose PR is merged (also runs before run/next)
  factory up <issue> | --main     move the stack to the ticket's worktree (or the main checkout): down, up, then serve
  factory down                    stop the stack where it is up

Options:
  --repo <path>     repository to work on (default: current directory)
  --dry-run         show what would happen; no GitHub writes, no agents
  --no-sandbox      run claude without srt (worktree isolation only)
  --force           take over a ticket already labelled ${LABELS.working}; with resume: resume while the run goes on;
                    with up: carry on when down fails
  --main            with up: the main checkout instead of a ticket's worktree
  --no-serve        with up: start the stack but not the serve command
  --step <name>     with resume or log: the step to use (e.g. "review 1")
  --local           with status --json: only the runs in .git/factory, no GitHub calls
  --fresh           with status --json: ask GitHub now instead of reusing the answer of the last minute`

const REQUIRED_TOOLS = ['git', 'gh', 'claude']
const SANDBOX_TOOLS = ['srt', 'bwrap', 'socat', 'rg']
/** The apt package of each sandbox tool apt installs; srt comes from npm. */
const SANDBOX_APT_PACKAGES = Object.freeze({ bwrap: 'bubblewrap', socat: 'socat', rg: 'ripgrep' })
/** A sandbox shaped like srt's: an installed bwrap can still be refused user or network namespaces. */
const BWRAP_PROBE_ARGS = ['--ro-bind', '/', '/', '--dev', '/dev', '--unshare-net', 'true']
/** Ubuntu 23.10+ sets this to 1, which blocks bwrap's namespaces unless an AppArmor profile allows them. */
const APPARMOR_USERNS_SYSCTL = '/proc/sys/kernel/apparmor_restrict_unprivileged_userns'
const BWRAP_APPARMOR_PROFILE = '/etc/apparmor.d/bwrap'
const BWRAP_APPARMOR_FIX = `sudo tee ${BWRAP_APPARMOR_PROFILE} >/dev/null <<'EOF'
abi <abi/4.0>,
include <tunables/global>

profile bwrap /usr/bin/bwrap flags=(unconfined) {
  userns,
  include if exists <local/bwrap>
}
EOF
sudo apparmor_parser -r ${BWRAP_APPARMOR_PROFILE}`

const log = (message) => console.log(`▸ ${message}`)

const readSysctl = (path) => {
    try {
        return readFileSync(path, 'utf8').trim()
    } catch {
        return null
    }
}

/** null when there's nothing to probe: not Linux, or no bwrap. */
const bwrapSandboxWorks = () => (process.platform === 'linux' && hasCommand('bwrap') ? succeeds('bwrap', BWRAP_PROBE_ARGS) : null)

async function doctor(repo) {
    const config = await loadConfig(repo.root)
    const bwrapWorks = bwrapSandboxWorks()
    const rows = [
        ...[...REQUIRED_TOOLS, ...SANDBOX_TOOLS].map((tool) => [tool, hasCommand(tool), SANDBOX_TOOLS.includes(tool) ? 'needed for the srt sandbox' : 'required']),
        ...(bwrapWorks === null ? [] : [['bwrap sandbox', bwrapWorks, 'bwrap is installed but cannot create a sandbox (see below)']]),
        ['gh auth', succeeds('gh', ['auth', 'status']), 'run: gh auth login'],
        ['.factory.json', Boolean(config.path), 'optional: setup and check commands for this repo'],
        ...stackConfigProblems(config).map((problem) => ['stack config', false, problem]),
    ]
    rows.forEach(([name, ok, hint]) => console.log(`${ok ? '✓' : '✗'} ${name.padEnd(14)} ${ok ? '' : hint}`))
    console.log(`\nrepo ${repo.root} · base ${config.baseBranch} · ${config.setup.length} setup / ${config.checks.length} check command(s)`)
    const missingSandboxTools = SANDBOX_TOOLS.filter((tool) => !hasCommand(tool))
    const missingAptPackages = missingSandboxTools.map((tool) => SANDBOX_APT_PACKAGES[tool]).filter(Boolean)
    if (missingSandboxTools.includes('srt')) {
        console.log('\nsrt: npm install -g @anthropic-ai/sandbox-runtime')
    }
    if (missingAptPackages.length) {
        console.log(`\nsandbox tools: sudo apt install ${missingAptPackages.join(' ')}`)
    }
    if (bwrapWorks === false) {
        console.log(readSysctl(APPARMOR_USERNS_SYSCTL) === '1' && !existsSync(BWRAP_APPARMOR_PROFILE)
            ? `\nbwrap sandbox: AppArmor blocks bwrap's user namespaces. Allow them for bwrap only:\n${BWRAP_APPARMOR_FIX}`
            : `\nbwrap sandbox: run \`bwrap ${BWRAP_PROBE_ARGS.join(' ')}\` to see why it fails, or pass --no-sandbox`)
    }
}

const clockTime = (iso) => {
    const date = new Date(iso)

    return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`
}

async function status(repo, { json, local, fresh }) {
    const state = await factoryStatus(repo, { local: json && local, cached: json && !fresh })
    if (json) {
        console.log(JSON.stringify(state, null, 2))
        return
    }
    if (state.stack) {
        console.log(`stack: ${checkoutLabel(state.stack.checkout)} (since ${clockTime(state.stack.since)})`)
    }
    if (state.tickets.length === 0) {
        console.log('No open tickets carry a factory label.')
        return
    }
    state.tickets.forEach((ticket) => {
        const pr = ticket.pr ? `PR #${ticket.pr.number}${ticket.pr.isDraft ? ' (draft)' : ''}` : ''
        const running = ticket.run?.steps.findLast((step) => step.status === STEP_STATUSES.running)
        const blocked = ticket.blockedBy.length > 0 ? ` (blocked by ${ticket.blockedBy.map((number) => `#${number}`).join(', ')})` : ''
        console.log(`#${String(ticket.number).padEnd(5)} ${ticket.state.padEnd(16)} ${pr.padEnd(16)} ${ticket.title}${blocked}${running ? `  ▸ ${running.name}` : ''}`)
    })
}

async function next(repo, runOptions) {
    const ready = await listReadyIssues({ cwd: repo.root })
    const unblocked = ready.filter((issue) => issue.openBlockers === 0 && !issue.labels.includes(LABELS.working))
    if (unblocked.length === 0) {
        log(`no unblocked ${LABELS.ready} ticket (${ready.length} ready, all blocked or in progress)`)
        return
    }

    await runTicket({ repo, issueNumber: unblocked[0].number, ...runOptions })
}

/** Clears merged worktrees before a run; a failure here never blocks the run. */
async function cleanBeforeRun(repo, { options }) {
    if (options.dryRun) {
        return
    }
    await cleanMergedWorktrees({ repo, log }).catch((error) => log(`skipped worktree cleanup: ${error.message}`))
}

function stackCheckoutFrom(argument, { main }) {
    if (main && argument === undefined) {
        return MAIN_CHECKOUT
    }
    if (main || argument === undefined) {
        throw new FactoryError(ERROR_CODES.usage, 'factory up needs an issue number or --main')
    }

    return issueNumberFrom(argument, 'up')
}

function issueNumberFrom(argument, command) {
    const issueNumber = Number(argument)
    if (!Number.isInteger(issueNumber) || issueNumber <= 0) {
        throw new FactoryError(ERROR_CODES.usage, `factory ${command} needs an issue number`)
    }

    return issueNumber
}

async function main() {
    const { values, positionals } = parseArgs({
        allowPositionals: true,
        options: {
            repo: { type: 'string' },
            'dry-run': { type: 'boolean', default: false },
            'no-sandbox': { type: 'boolean', default: false },
            force: { type: 'boolean', default: false },
            json: { type: 'boolean', default: false },
            step: { type: 'string' },
            local: { type: 'boolean', default: false },
            fresh: { type: 'boolean', default: false },
            main: { type: 'boolean', default: false },
            'no-serve': { type: 'boolean', default: false },
            help: { type: 'boolean', short: 'h', default: false },
        },
    })
    const [command, issueArgument] = positionals
    if (values.help || !command) {
        console.log(USAGE)
        return
    }

    const repo = await locateRepo(resolve(values.repo ?? process.cwd()))
    const config = await loadConfig(repo.root)
    const runOptions = {
        config,
        log,
        options: { dryRun: values['dry-run'], sandbox: !values['no-sandbox'], force: values.force },
    }

    if (['run', 'next'].includes(command) && !values['dry-run']) {
        const missing = [...REQUIRED_TOOLS, ...(runOptions.options.sandbox ? SANDBOX_TOOLS : [])].filter((tool) => !hasCommand(tool))
        if (missing.length > 0) {
            throw new FactoryError(ERROR_CODES.missingTool, `missing: ${missing.join(', ')} (run factory doctor, or pass --no-sandbox)`)
        }
    }

    switch (command) {
        case 'doctor':
            return doctor(repo)
        case 'init':
            await ensureFactoryLabels({ cwd: repo.root })
            log('labels ready')
            return
        case 'status':
            return status(repo, { json: values.json, local: values.local, fresh: values.fresh })
        case 'watch':
            process.stdout.on('error', (error) => {
                if (error.code === 'EPIPE') {
                    process.exit(0)
                }
            })
            return watchRun({ repo, issueNumber: issueNumberFrom(issueArgument, command) })
        case 'resume':
            return resumeSession({ repo, issueNumber: issueNumberFrom(issueArgument, command), stepName: values.step, force: values.force })
        case 'log': {
            const written = await writeRunMarkdown({ repo, issueNumber: issueNumberFrom(issueArgument, command), stepName: values.step })
            console.log(values.json ? JSON.stringify(written) : join(repo.root, written.path))
            return
        }
        case 'clean': {
            const result = await cleanMergedWorktrees({ repo, log: values.json ? () => {} : log, dryRun: values['dry-run'] })
            if (values.json) {
                console.log(JSON.stringify(result))
                return
            }
            const { removed } = result
            log(removed.length === 0 ? 'no merged worktree to remove' : `${values['dry-run'] ? 'would remove' : 'removed'} ${removed.map((number) => `#${number}`).join(', ')}`)
            return
        }
        case 'run':
            await cleanBeforeRun(repo, runOptions)
            await runTicket({ repo, issueNumber: issueNumberFrom(issueArgument, command), ...runOptions })
            return
        case 'next':
            await cleanBeforeRun(repo, runOptions)
            return next(repo, runOptions)
        case 'up':
            return stackUp({ repo, config, checkout: stackCheckoutFrom(issueArgument, { main: values.main }), serve: !values['no-serve'], force: values.force, log })
        case 'down':
            return stackDown({ repo, config, log })
        default:
            throw new FactoryError(ERROR_CODES.usage, `unknown command "${command}"\n\n${USAGE}`)
    }
}

const invokedDirectly = process.argv[1] && realpathSync(process.argv[1]) === realpathSync(new URL(import.meta.url).pathname)
if (invokedDirectly) {
    main().catch((error) => {
        console.error(`✗ ${error.code ? `[${error.code}] ` : ''}${error.message}`)
        process.exitCode = 1
    })
}
