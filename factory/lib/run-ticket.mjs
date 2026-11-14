import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { agentLogName, runClaude, sandboxSettings, writeSandboxSettings } from './agent.mjs'
import { ERROR_CODES, FactoryError, LABELS, REVIEW_VERDICTS, branchForIssue } from './constants.mjs'
import { commentOnIssue, createDraftPr, editPrBody, findOpenPrForBranch, swapLabels, viewIssue } from './github.mjs'
import { PR_BODY_ALLOWED_TOOLS, PR_BODY_SCHEMA, REVIEW_ALLOWED_TOOLS, REVIEW_SCHEMA, implementPrompt, prBodyPrompt, reviewPrompt, reworkPrompt } from './prompts.mjs'
import { runCheckCommand, runShellCommand } from './shell.mjs'
import { commitsAhead, prepareWorktree, pushBranch, worktreePathFor } from './worktree.mjs'

const READ_ONLY_PERMISSION_MODE = 'dontAsk'
const CHECK_OUTPUT_TAIL_LINES = 40

function parseReview(structuredOutput, logPath) {
    const verdict = structuredOutput?.verdict
    if (!Object.values(REVIEW_VERDICTS).includes(verdict) || !Array.isArray(structuredOutput.findings)) {
        throw new FactoryError(ERROR_CODES.invalidReview, `review returned no valid verdict (log: ${logPath})`)
    }

    return { verdict, findings: structuredOutput.findings, report: structuredOutput.report ?? '' }
}

function parsePrBody(structuredOutput, logPath) {
    if (typeof structuredOutput?.body !== 'string' || structuredOutput.body.trim() === '') {
        throw new FactoryError(ERROR_CODES.invalidPrBody, `PR body run returned no body (log: ${logPath})`)
    }

    return structuredOutput.body.trim()
}

const tail = (text, lines) => text.trimEnd().split('\n').slice(-lines).join('\n')

/**
 * Runs the repo's checks on the host, so the factory never takes an agent's word that they pass.
 * @returns {Promise<string[]>} one finding per failing check
 */
async function failingChecks({ checks, cwd, runDir, attempt, log }) {
    const failures = []
    for (const [index, command] of checks.entries()) {
        log(`check: ${command}`)
        const { passed, output } = await runCheckCommand(command, { cwd })
        await writeFile(join(runDir, `checks-${attempt}-${index + 1}.log`), `$ ${command}\n\n${output}`)
        if (!passed) {
            failures.push(`Automated check \`${command}\` fails. Last lines of its output:\n\`\`\`\n${tail(output, CHECK_OUTPUT_TAIL_LINES)}\n\`\`\``)
        }
    }

    return failures
}

function reviewHeader(review, reworks) {
    return `Automated review: ${review.verdict}${reworks > 0 ? ` after ${reworks} rework run(s)` : ''}`
}

function prBody({ issue, body, review, reworks, implementationReport }) {
    return [
        `Closes #${issue.number}`,
        body,
        `<details>\n<summary>${reviewHeader(review, reworks)}</summary>\n\n${review.report || review.findings.map((finding) => `- ${finding}`).join('\n')}\n</details>`,
        `<details>\n<summary>Implementer's report</summary>\n\n${implementationReport}\n</details>`,
    ].join('\n\n')
}

/**
 * One factory run for one ticket: lock → worktree → /implement (+ /no-comments) → checks + /matt-code-review, reworked
 * up to maxReworks → push → /pr body → draft PR → relabel.
 * GitHub labels are the only state; any failure hands the ticket to a human with the reason as a comment.
 */
export async function runTicket({ repo, issueNumber, config, options, log }) {
    const cwd = repo.root
    const issue = await viewIssue(issueNumber, { cwd })
    if (issue.state !== 'OPEN') {
        throw new FactoryError(ERROR_CODES.issueNotOpen, `#${issue.number} is ${issue.state.toLowerCase()}`)
    }
    if (issue.labels.includes(LABELS.working) && !options.force) {
        throw new FactoryError(ERROR_CODES.issueLocked, `#${issue.number} is labelled ${LABELS.working}; another run may be on it (use --force to take over)`)
    }
    if (!options.sandbox && config.permissionMode === 'bypassPermissions') {
        throw new FactoryError(ERROR_CODES.unsafeConfig, 'permissionMode "bypassPermissions" is only allowed inside the srt sandbox')
    }

    const base = config.baseBranch
    const branch = branchForIssue(issue.number)
    const worktreePath = worktreePathFor(repo.root, issue.number)
    const runDir = join(repo.gitDir, 'factory', `issue-${issue.number}`, new Date().toISOString().replace(/[:.]/g, '-'))
    const settings = sandboxSettings({ worktreePath, gitDir: repo.gitDir, extraAllowWrite: config.sandbox.allowWrite, extraDenyRead: config.sandbox.denyRead })

    log(`#${issue.number} ${issue.title}`)
    log(`branch ${branch} · worktree ${worktreePath}`)
    if (options.dryRun) {
        log(`dry run: would label ${LABELS.working}, set up the worktree (${config.setup.length} setup command(s)), /implement with ${config.models.implement}, run ${config.checks.length} check(s) and /matt-code-review with ${config.models.review} (≤${config.maxReworks} rework), push, write the body with /pr (${config.models.pr}) and open a draft PR into ${base}`)
        log(options.sandbox ? `srt settings:\n${JSON.stringify(settings, null, 2)}` : 'no sandbox: claude runs directly on the host')

        return { dryRun: true }
    }

    await mkdir(runDir, { recursive: true })
    await swapLabels(issue, { add: [LABELS.working], remove: [LABELS.ready, LABELS.done, LABELS.human] }, { cwd })

    try {
        const { created } = await prepareWorktree({ root: repo.root, path: worktreePath, branch, base })
        if (created) {
            for (const command of config.setup) {
                log(`setup: ${command}`)
                await runShellCommand(command, { cwd: worktreePath })
            }
        } else {
            log('reusing the existing worktree')
        }

        let settingsPath = null
        if (options.sandbox) {
            settingsPath = join(runDir, 'srt-settings.json')
            await writeSandboxSettings(settingsPath, settings)
        }
        log(`run logs in ${runDir}`)
        const agentRun = (name, fields) => runClaude({ cwd: worktreePath, settingsPath, timeoutMinutes: config.agentTimeoutMinutes, logPath: join(runDir, agentLogName(name)), ...fields })

        log(`implementing with ${config.models.implement}…`)
        const implementation = await agentRun('implement', { prompt: implementPrompt({ issue, base, checks: config.checks }), model: config.models.implement, permissionMode: config.permissionMode })

        if (await commitsAhead({ root: repo.root, base, branch }) === 0) {
            log('no commits: handing the ticket to a human')
            await commentOnIssue(issue.number, `Factory run made no commits on \`${branch}\`.\n\n${implementation.result}`, { cwd })
            await swapLabels(issue, { add: [LABELS.human], remove: [LABELS.working] }, { cwd })

            return { outcome: LABELS.human, prUrl: null }
        }

        let review
        let reworks = 0
        for (let attempt = 1; ; attempt++) {
            const checkFailures = await failingChecks({ checks: config.checks, cwd: worktreePath, runDir, attempt, log })
            if (checkFailures.length > 0) {
                review = { verdict: REVIEW_VERDICTS.fail, findings: checkFailures, report: '' }
                log(`checks: ${checkFailures.length} failing, skipping the review`)
            } else {
                log(`reviewing with /matt-code-review on ${config.models.review} (attempt ${attempt})…`)
                const logName = `review-${attempt}`
                const reviewRun = await agentRun(logName, {
                    prompt: reviewPrompt({ issue, base }),
                    model: config.models.review,
                    permissionMode: READ_ONLY_PERMISSION_MODE,
                    allowedTools: REVIEW_ALLOWED_TOOLS,
                    jsonSchema: REVIEW_SCHEMA,
                })
                review = parseReview(reviewRun.structuredOutput, join(runDir, agentLogName(logName)))
                log(`review: ${review.verdict}${review.findings.length ? ` (${review.findings.length} finding(s))` : ''}`)
            }
            if (review.verdict === REVIEW_VERDICTS.pass || reworks === config.maxReworks) {
                break
            }

            reworks++
            log(`rework ${reworks}/${config.maxReworks} with ${config.models.implement}…`)
            await agentRun(`rework-${reworks}`, { prompt: reworkPrompt({ issue, findings: review.findings, checks: config.checks }), model: config.models.implement, permissionMode: config.permissionMode })
        }

        log(`pushing ${branch}`)
        await pushBranch({ root: repo.root, branch })
        log(`writing the PR body with /pr on ${config.models.pr}…`)
        const prBodyRun = await agentRun('pr-body', {
            prompt: prBodyPrompt({ issue, base, implementationReport: implementation.result, reviewReport: review.report || review.findings.join('\n') }),
            model: config.models.pr,
            permissionMode: READ_ONLY_PERMISSION_MODE,
            allowedTools: PR_BODY_ALLOWED_TOOLS,
            jsonSchema: PR_BODY_SCHEMA,
        })
        const body = prBody({ issue, body: parsePrBody(prBodyRun.structuredOutput, join(runDir, agentLogName('pr-body'))), review, reworks, implementationReport: implementation.result })
        const existingPr = await findOpenPrForBranch(branch, { cwd })
        if (existingPr) {
            await editPrBody(existingPr.number, body, { cwd })
        }
        const prUrl = existingPr?.url ?? await createDraftPr({ base, branch, title: issue.title, body }, { cwd })
        const report = `**${reviewHeader(review, reworks)}**${review.findings.length ? `\n\n${review.findings.map((finding) => `- ${finding}`).join('\n')}` : ''}`

        const passed = review.verdict === REVIEW_VERDICTS.pass
        await commentOnIssue(issue.number, `Factory run finished: ${prUrl}\n\n${report}`, { cwd })
        await swapLabels(issue, { add: [passed ? LABELS.done : LABELS.human], remove: [LABELS.working] }, { cwd })
        log(`${passed ? 'done' : 'review still failing, handed to a human'}: ${prUrl}`)

        return { outcome: passed ? LABELS.done : LABELS.human, prUrl }
    } catch (error) {
        await commentOnIssue(issue.number, `Factory run stopped: ${error.message}\n\nThe worktree is kept at \`${worktreePath}\`.`, { cwd }).catch(() => {})
        await swapLabels(issue, { add: [LABELS.human], remove: [LABELS.working] }, { cwd }).catch(() => {})
        throw error
    }
}
