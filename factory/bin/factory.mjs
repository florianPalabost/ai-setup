#!/usr/bin/env node
import { realpathSync } from 'node:fs'
import { basename, resolve } from 'node:path'
import { parseArgs } from 'node:util'
import { loadConfig } from '../lib/config.mjs'
import { ERROR_CODES, FACTORY_LABELS, FactoryError, LABELS } from '../lib/constants.mjs'
import { ensureFactoryLabels, factoryState, listReadyIssues } from '../lib/github.mjs'
import { runTicket } from '../lib/run-ticket.mjs'
import { hasCommand, succeeds } from '../lib/shell.mjs'
import { locateRepo } from '../lib/worktree.mjs'

const USAGE = `factory: run agent tickets from GitHub, one at a time

Usage:
  factory doctor                  check tools, gh login and the repo's .factory.json
  factory init                    create the ${FACTORY_LABELS.map((label) => label.name).join(' / ')} labels
  factory status [--json]         tickets the factory tracks, with their PRs
  factory run <issue> [options]   implement → review → draft PR for one ticket
  factory next [options]          run the oldest unblocked ${LABELS.ready} ticket

Options:
  --repo <path>     repository to work on (default: current directory)
  --dry-run         show what would happen; no GitHub writes, no agents
  --no-sandbox      run claude without srt (worktree isolation only)
  --force           take over a ticket already labelled ${LABELS.working}`

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

async function status(repo, { json }) {
    const tickets = await factoryState({ cwd: repo.root })
    if (json) {
        console.log(JSON.stringify(tickets, null, 2))
        return
    }
    if (tickets.length === 0) {
        console.log('No open tickets carry a factory label.')
        return
    }
    tickets.forEach((ticket) => {
        const pr = ticket.pr ? `PR #${ticket.pr.number}${ticket.pr.isDraft ? ' (draft)' : ''}` : ''
        console.log(`#${String(ticket.number).padEnd(5)} ${ticket.state.padEnd(16)} ${pr.padEnd(16)} ${ticket.title}`)
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

async function main() {
    const { values, positionals } = parseArgs({
        allowPositionals: true,
        options: {
            repo: { type: 'string' },
            'dry-run': { type: 'boolean', default: false },
            'no-sandbox': { type: 'boolean', default: false },
            force: { type: 'boolean', default: false },
            json: { type: 'boolean', default: false },
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
            return status(repo, { json: values.json })
        case 'run': {
            const issueNumber = Number(issueArgument)
            if (!Number.isInteger(issueNumber) || issueNumber <= 0) {
                throw new FactoryError(ERROR_CODES.usage, 'factory run needs an issue number')
            }
            await runTicket({ repo, issueNumber, ...runOptions })
            return
        }
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
