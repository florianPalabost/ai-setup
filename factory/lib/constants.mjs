export const LABELS = Object.freeze({
    ready: 'ready-for-agent',
    working: 'agent-working',
    done: 'agent-done',
    human: 'ready-for-human',
})

export const FACTORY_LABELS = Object.freeze([
    { name: LABELS.working, color: 'FBCA04', description: 'A factory run is working on this ticket' },
    { name: LABELS.done, color: '0E8A16', description: 'Factory run finished; draft PR passed automated review' },
])

export const ERROR_CODES = Object.freeze({
    usage: 'usage',
    notARepo: 'not_a_repo',
    missingTool: 'missing_tool',
    commandFailed: 'command_failed',
    issueNotOpen: 'issue_not_open',
    issueLocked: 'issue_locked',
    noReadyIssue: 'no_ready_issue',
    agentFailed: 'agent_failed',
    invalidReview: 'invalid_review',
    invalidPrBody: 'invalid_pr_body',
    unsafeConfig: 'unsafe_config',
})

export const REVIEW_VERDICTS = Object.freeze({
    pass: 'pass',
    fail: 'fail',
})

export class FactoryError extends Error {
    constructor(code, message) {
        super(message)
        this.code = code
    }
}

export const branchForIssue = (issueNumber) => `agent/issue-${issueNumber}`
