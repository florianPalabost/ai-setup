import { REVIEW_VERDICTS } from './constants.mjs'

export const REVIEW_SCHEMA = Object.freeze({
    type: 'object',
    properties: {
        verdict: { type: 'string', enum: Object.values(REVIEW_VERDICTS) },
        findings: { type: 'array', items: { type: 'string' } },
        report: { type: 'string' },
    },
    required: ['verdict', 'findings', 'report'],
})

export const PR_BODY_SCHEMA = Object.freeze({
    type: 'object',
    properties: {
        body: { type: 'string' },
    },
    required: ['body'],
})

const READ_ONLY_TOOLS = ['Read', 'Grep', 'Glob', 'Bash(git diff *)', 'Bash(git log *)', 'Bash(git show *)', 'Bash(git rev-parse *)']

/** Read-only tools plus the Skill and Agent tools /matt-code-review needs for its two parallel sub-agents; it runs under dontAsk, so anything else is refused. */
export const REVIEW_ALLOWED_TOOLS = Object.freeze([...READ_ONLY_TOOLS, 'Skill', 'Agent'])

/** Read-only tools plus Skill for /pr and /unslop. */
export const PR_BODY_ALLOWED_TOOLS = Object.freeze([...READ_ONLY_TOOLS, 'Skill'])

function ticketSection(issue) {
    const comments = issue.comments.map((comment) => `**${comment.author}:**\n${comment.body}`).join('\n\n---\n\n')

    return [
        `# Ticket #${issue.number}: ${issue.title}`,
        issue.body || '(no description)',
        comments ? `## Comments\n\n${comments}` : '',
    ].filter(Boolean).join('\n\n')
}

function checksSection(checks) {
    if (checks.length === 0) {
        return 'Run the project\'s tests and linters before each commit; they must pass.'
    }

    return `Before each commit, every one of these must pass:\n${checks.map((check) => `- \`${check}\``).join('\n')}`
}

const UNATTENDED_RULES = `# Rules
- You are running unattended. Nobody will answer questions, and any tool call that would need approval is refused. Wherever a skill tells you to ask or confirm with the user, decide yourself and record the decision in your final message.
- You have no network access except the model API. Do not push, open PRs, or call GitHub. The ticket is given above: do not fetch it.
- Read CLAUDE.md / AGENTS.md first and follow the repository's conventions.
- Make small, focused commits in conventional commit format (\`type: description\`). Never mention AI or Claude in commit messages.`

/** The slash command must open the prompt: headless claude only expands a skill when the prompt starts with it. */
export function implementPrompt({ issue, base, checks }) {
    return `/implement
${ticketSection(issue)}

# Factory overrides to the implement workflow
- TDD: pick the seams yourself (the ticket's public behaviour, at the highest seam that runs fast) and list them in your final message. Do not wait for confirmation.
- Skip the implement skill's own matt-code-review step: the factory runs it as a separate, cold review after you finish.
- After the work is committed, call the Skill tool with "no-comments" on the scope \`git diff origin/${base}...HEAD\`. No constraint encodings are pre-approved: report them open. Commit its changes separately (\`refactor: remove narration comments\` or similar), with the checks green.
- If the ticket is too ambiguous to implement safely, make no commits and explain what is unclear in your final message.

${checksSection(checks)}

${UNATTENDED_RULES}

End with a report for the human reviewer, not a PR description:
- **Decisions:** the rule or option you chose where the ticket left one open, and the TDD seams.
- **Evidence:** each new or changed test, and what it showed failing before the fix and passing after.
- **Checks:** which passed, which failed or could not run, and why.
- **Open:** anything left for a human (behaviour changes outside the ticket, constraints /no-comments reported open).`
}

export function reviewPrompt({ issue, base }) {
    return `/matt-code-review origin/${base}

The fixed point is \`origin/${base}\`. The spec is ticket #${issue.number}, given in full below: do not fetch it from the tracker (there is no network).

${ticketSection(issue)}

# Factory rules
- You are running unattended and must not edit any file. Do not ask anything: the fixed point and the spec are above.
- Always spawn the Standards and Spec sub-agents in parallel, however small the diff: the separation is the point of this review.
- Do not run tests or linters: the factory already ran its checks and they pass.
- After aggregating the two axes, decide the verdict:
  - "${REVIEW_VERDICTS.fail}" if the Standards axis found a hard violation of a documented standard, or the Spec axis found a missing or partial requirement or a wrong implementation.
  - "${REVIEW_VERDICTS.pass}" otherwise. Baseline smells and scope creep alone are judgement calls: report them, but they do not fail the review.
- \`findings\`: only the findings that caused a fail, each naming the file and what to change. Empty on a pass.
- \`report\`: the aggregated review as markdown, with the \`## Standards\` and \`## Spec\` sections and the one-line summary, judgement calls included.`
}

export function reworkPrompt({ issue, findings, checks }) {
    return `${ticketSection(issue)}

# Task
An automated review of this branch failed. Fix only these findings, nothing else. Where a fix changes behaviour, write the failing test first. Add no narration comments.
${findings.map((finding, index) => `${index + 1}. ${finding}`).join('\n')}

${checksSection(checks)}

${UNATTENDED_RULES}

End with one line per finding saying how you fixed it.`
}

export function prBodyPrompt({ issue, base, implementationReport, reviewReport }) {
    return `/pr
Write the PR body for branch HEAD against \`origin/${base}\`, which implements ticket #${issue.number}. See the change with \`git diff origin/${base}...HEAD\` and \`git log origin/${base}..HEAD\`.

${ticketSection(issue)}

# Implementer's report
Use it for the Evidence section (the tests that failed before and pass after) and for Merge Danger. Do not copy it verbatim.

${implementationReport}

# Automated review
${reviewReport}

# Factory rules
- You are running unattended and must not edit any file. Do not ask anything.
- Do not include a "Closes #" line or the review: the factory adds both.
- Once drafted, call the Skill tool with "unslop" on the body and apply its edits.
- \`body\`: the final PR body in markdown, nothing else.`
}
