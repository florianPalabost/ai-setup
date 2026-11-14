import { FACTORY_LABELS, LABELS, branchForIssue } from './constants.mjs'
import { run } from './shell.mjs'

const gh = (args, { cwd, input } = {}) => run('gh', args, { cwd, input })
const ghJson = async (args, options) => JSON.parse(await gh(args, options))

/**
 * @returns {Promise<{ number: number, title: string, body: string, state: string, url: string, labels: string[], comments: { author: string, body: string }[] }>}
 */
export async function viewIssue(issueNumber, { cwd }) {
    const issue = await ghJson(['issue', 'view', String(issueNumber), '--json', 'number,title,body,state,url,labels,comments'], { cwd })

    return {
        ...issue,
        labels: issue.labels.map((label) => label.name),
        comments: issue.comments.map((comment) => ({ author: comment.author?.login ?? 'unknown', body: comment.body })),
    }
}

/** Swaps labels, skipping removals of labels the issue doesn't carry. */
export async function swapLabels(issue, { add = [], remove = [] }, { cwd }) {
    const toRemove = remove.filter((label) => issue.labels.includes(label))
    const toAdd = add.filter((label) => !issue.labels.includes(label))
    if (toAdd.length === 0 && toRemove.length === 0) {
        return
    }

    const args = ['issue', 'edit', String(issue.number)]
    toAdd.forEach((label) => args.push('--add-label', label))
    toRemove.forEach((label) => args.push('--remove-label', label))
    await gh(args, { cwd })
    issue.labels = [...issue.labels.filter((label) => !toRemove.includes(label)), ...toAdd]
}

export const commentOnIssue = (issueNumber, body, { cwd }) =>
    gh(['issue', 'comment', String(issueNumber), '--body-file', '-'], { cwd, input: body })

/**
 * Open ready-for-agent issues, oldest first, with their count of open blockers
 * from GitHub's native issue dependencies.
 */
export async function listReadyIssues({ cwd }) {
    const issues = await ghJson(['api', '--paginate', '--slurp', '-X', 'GET', 'repos/{owner}/{repo}/issues', '-f', `labels=${LABELS.ready}`, '-f', 'state=open', '-f', 'sort=created', '-f', 'direction=asc'], { cwd })

    return issues
        .flat()
        .filter((issue) => !issue.pull_request)
        .map((issue) => ({
            number: issue.number,
            title: issue.title,
            openBlockers: issue.issue_dependencies_summary?.blocked_by ?? 0,
            labels: issue.labels.map((label) => label.name),
        }))
}

export async function findOpenPrForBranch(branch, { cwd }) {
    const prs = await ghJson(['pr', 'list', '--head', branch, '--state', 'open', '--json', 'number,url,isDraft'], { cwd })

    return prs[0] ?? null
}

export const editPrBody = (prNumber, body, { cwd }) =>
    gh(['pr', 'edit', String(prNumber), '--body-file', '-'], { cwd, input: body })

export async function createDraftPr({ base, branch, title, body }, { cwd }) {
    const output = await gh(['pr', 'create', '--draft', '--base', base, '--head', branch, '--title', title, '--body-file', '-'], { cwd, input: body })

    return output.trim().split('\n').pop()
}

export async function ensureFactoryLabels({ cwd }) {
    for (const label of FACTORY_LABELS) {
        await gh(['label', 'create', label.name, '--color', label.color, '--description', label.description, '--force'], { cwd })
    }
}

/** Open issues that block this one, from GitHub's native issue dependencies. */
async function openBlockers(issueNumber, { cwd }) {
    const blockers = await ghJson(['api', `repos/{owner}/{repo}/issues/${issueNumber}/dependencies/blocked_by`], { cwd })

    return blockers.filter((blocker) => blocker.state === 'open').map((blocker) => blocker.number)
}

/**
 * Every open issue carrying a factory label, joined with the open PR on its agent branch and the open issues blocking it.
 * This is the factory's whole state on GitHub; run progress lives in .git/factory.
 * @returns {Promise<{ number: number, title: string, url: string, state: string, pr: { number: number, url: string, isDraft: boolean } | null, blockedBy: number[] }[]>}
 */
export async function factoryState({ cwd }) {
    const trackedLabels = Object.values(LABELS)
    const [issuePages, prs] = await Promise.all([
        ghJson(['api', '--paginate', '--slurp', '-X', 'GET', 'repos/{owner}/{repo}/issues', '-f', 'state=open', '-f', 'per_page=100'], { cwd }),
        ghJson(['pr', 'list', '--state', 'open', '--limit', '200', '--json', 'number,url,isDraft,headRefName'], { cwd }),
    ])
    const prsByBranch = new Map(prs.map(({ headRefName, ...pr }) => [headRefName, pr]))
    const tracked = issuePages
        .flat()
        .filter((issue) => !issue.pull_request)
        .map((issue) => ({ ...issue, labels: issue.labels.map((label) => label.name) }))
        .filter((issue) => issue.labels.some((label) => trackedLabels.includes(label)))

    const tickets = await Promise.all(
        tracked.map(async (issue) => ({
            number: issue.number,
            title: issue.title,
            url: issue.html_url,
            state: trackedLabels.find((label) => issue.labels.includes(label)),
            pr: prsByBranch.get(branchForIssue(issue.number)) ?? null,
            blockedBy: issue.issue_dependencies_summary?.blocked_by > 0 ? await openBlockers(issue.number, { cwd }) : [],
        })),
    )

    return tickets.sort((left, right) => left.number - right.number)
}
