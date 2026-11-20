import { FACTORY_LABELS, LABELS, branchForIssue } from './constants.mjs'
import { run } from './shell.mjs'

const gh = (args, { cwd, input } = {}) => run('gh', args, { cwd, input })
const ghJson = async (args, options) => JSON.parse(await gh(args, options))

/** Every item of a paginated REST list. `--jq '.[]'` prints one item per line, and works on gh releases older than `--slurp` (2.48). */
const ghPaginatedItems = async (args, options) =>
    (await gh(['api', '--paginate', '--jq', '.[]', ...args], options))
        .split('\n')
        .filter((line) => line.trim() !== '')
        .map((line) => JSON.parse(line))

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
    const issues = await ghPaginatedItems(['-X', 'GET', 'repos/{owner}/{repo}/issues', '-f', `labels=${LABELS.ready}`, '-f', 'state=open', '-f', 'sort=created', '-f', 'direction=asc'], { cwd })

    return issues
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

/** How long `factory status` reuses gh's cached answer, so the boards polling it share one GitHub call a minute. */
export const STATUS_CACHE = '60s'
const PAGE_SIZE = 100

/** Tracked issues and, on the first page only, the open PRs: one GraphQL call per 100 tickets, blockers included. */
const FACTORY_STATE_QUERY = `query($owner: String!, $name: String!, $labels: [String!], $after: String, $withPrs: Boolean!) {
  repository(owner: $owner, name: $name) {
    issues(states: OPEN, labels: $labels, first: ${PAGE_SIZE}, after: $after) {
      pageInfo { hasNextPage endCursor }
      nodes {
        number title url
        labels(first: 20) { nodes { name } }
        blockedBy(first: 20) { nodes { number state } }
      }
    }
    pullRequests(states: OPEN, first: ${PAGE_SIZE}, orderBy: { field: CREATED_AT, direction: DESC }) @include(if: $withPrs) {
      nodes { number url isDraft headRefName }
    }
  }
}`

async function factoryStatePage({ labels, after, cache }, { cwd }) {
    const args = ['api', 'graphql', ...(cache ? ['--cache', cache] : []), '-F', 'owner={owner}', '-F', 'name={repo}', '-F', `withPrs=${after === null}`, '-f', `query=${FACTORY_STATE_QUERY}`]
    labels.forEach((label) => args.push('-f', `labels[]=${label}`))
    if (after !== null) {
        args.push('-f', `after=${after}`)
    }

    return (await ghJson(args, { cwd })).data.repository
}

/**
 * Every open issue carrying a factory label, joined with the open PR on its agent branch and the open issues blocking it.
 * This is the factory's whole state on GitHub; run progress lives in .git/factory.
 * `cache` is a gh duration ("60s") during which every caller gets the same answer without asking GitHub again.
 * @returns {Promise<{ number: number, title: string, url: string, state: string, pr: { number: number, url: string, isDraft: boolean } | null, blockedBy: number[] }[]>}
 */
export async function factoryState({ cwd, cache = null }) {
    const trackedLabels = Object.values(LABELS)
    const issues = []
    let prs = []
    for (let after = null; ; ) {
        const page = await factoryStatePage({ labels: trackedLabels, after, cache }, { cwd })
        issues.push(...page.issues.nodes)
        prs = page.pullRequests?.nodes ?? prs
        if (!page.issues.pageInfo.hasNextPage) {
            break
        }
        after = page.issues.pageInfo.endCursor
    }
    const prsByBranch = new Map(prs.map(({ headRefName, ...pr }) => [headRefName, pr]))

    return issues
        .map((issue) => {
            const labels = issue.labels.nodes.map((label) => label.name)

            return {
                number: issue.number,
                title: issue.title,
                url: issue.url,
                state: trackedLabels.find((label) => labels.includes(label)),
                pr: prsByBranch.get(branchForIssue(issue.number)) ?? null,
                blockedBy: issue.blockedBy.nodes.filter((blocker) => blocker.state === 'OPEN').map((blocker) => blocker.number),
            }
        })
        .sort((left, right) => left.number - right.number)
}

/**
 * Merged PRs from agent branches, keyed by branch, with the commit each was merged at.
 * @returns {Promise<Map<string, { number: number, headRefOid: string }>>}
 */
export async function mergedAgentPrs({ cwd }) {
    const prs = await ghJson(['pr', 'list', '--state', 'merged', '--limit', '200', '--search', 'head:agent/issue-', '--json', 'number,headRefName,headRefOid'], { cwd })

    return new Map(prs.map(({ headRefName, ...pr }) => [headRefName, pr]))
}
