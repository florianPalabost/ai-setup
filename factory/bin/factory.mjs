#!/usr/bin/env node
import { realpathSync } from 'node:fs'
import { basename, join, resolve } from 'node:path'
import { parseArgs } from 'node:util'
import { loadConfig } from '../lib/config.mjs'
import { ERROR_CODES, FACTORY_LABELS, FactoryError, LABELS } from '../lib/constants.mjs'
import { ensureFactoryLabels, listReadyIssues } from '../lib/github.mjs'
import { STEP_STATUSES } from '../lib/progress.mjs'
import { runTicket } from '../lib/run-ticket.mjs'
import { resumeSession, watchRun } from '../lib/session.mjs'
import { factoryStatus } from '../lib/status.mjs'
import { writeRunMarkdown } from '../lib/transcript.mjs'
import { hasCommand, succeeds } from '../lib/shell.mjs'
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

Options:
  --repo <path>     repository to work on (default: current directory)
  --dry-run         show what would happen; no GitHub writes, no agents
  --no-sandbox      run claude without srt (worktree isolation only)
  --force           take over a ticket already labelled ${LABELS.working}; with resume: resume while the run goes on
  --step <name>     with resume or log: the step to use (e.g. "review 1")
  --local           with status --json: only the runs in .git/factory, no GitHub calls`

const REQUIRED_TOOLS = ['git', 'gh', 'claude']
const SANDBOX_TOOLS = ['srt', 'bwrap', 'socat', 'rg']

const log = (message) => console.log(`▸ ${message}`)

async function doctor(repo) {
    const config = await loadConfig(repo.root)
    const rows = [
        ...[...REQUIRED_TOOLS, ...SANDBOX_TOOLS].map((tool) => [tool, hasCommand(tool), SANDBOX_TOOLS.includes(tool) ? 'needed for the srt sandbox' : 'required']),
        ['gh auth', succeeds('gh', ['auth', 'status']), 'run: gh auth login'],
        ['.factory.json', Boolean(config.path), 'optional: setup and check commands for this repo'],
    ]
    rows.forEach(([name, ok, hint]) => console.log(`${ok ? '✓' : '✗'} ${name.padEnd(14)} ${ok ? '' : hint}`))
    console.log(`\nrepo ${repo.root} · base ${config.baseBranch} · ${config.setup.length} setup / ${config.checks.length} check command(s)`)
    if (!SANDBOX_TOOLS.every(hasCommand)) {
        console.log('\nsrt: npm install -g @anthropic-ai/sandbox-runtime · socat/rg: sudo apt install socat ripgrep')
    }
}

async function status(repo, { json, local }) {
    const state = await factoryStatus(repo, { local: json && local })
    if (json) {
        console.log(JSON.stringify(state, null, 2))
        return
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
            log(`labels ready. To see the factory's worktrees in Orca: orca-ide repo set --repo name:${basename(repo.root)} --external-worktree-visibility show`)
            return
        case 'status':
            return status(repo, { json: values.json, local: values.local })
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
        case 'run':
            await runTicket({ repo, issueNumber: issueNumberFrom(issueArgument, command), ...runOptions })
            return
        case 'next':
            return next(repo, runOptions)
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
