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
 * from GitHub's native issue dependencies. Asks GitHub afresh: `next` starts a run on the first one.
 */
export async function listReadyIssues({ cwd }) {
    const { issues } = await labelledIssues({ labels: [LABELS.ready], withPrs: false, cache: null }, { cwd })

    return issues.map((issue) => ({
        number: issue.number,
        title: issue.title,
        openBlockers: openBlockerNumbers(issue).length,
        labels: issue.labels.nodes.map((label) => label.name),
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

/** Open issues with any of the labels, oldest first, and on the first page the open PRs: one GraphQL call per 100 issues, blockers included. */
const LABELLED_ISSUES_QUERY = `query($owner: String!, $name: String!, $labels: [String!], $after: String, $withPrs: Boolean!) {
  repository(owner: $owner, name: $name) {
    issues(states: OPEN, labels: $labels, first: ${PAGE_SIZE}, after: $after, orderBy: { field: CREATED_AT, direction: ASC }) {
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

async function labelledIssuesPage({ labels, after, withPrs, cache }, { cwd }) {
    const args = ['api', 'graphql', ...(cache ? ['--cache', cache] : []), '-F', 'owner={owner}', '-F', 'name={repo}', '-F', `withPrs=${withPrs && after === null}`, '-f', `query=${LABELLED_ISSUES_QUERY}`]
    labels.forEach((label) => args.push('-f', `labels[]=${label}`))
    if (after !== null) {
        args.push('-f', `after=${after}`)
    }

    return (await ghJson(args, { cwd })).data.repository
}

/** Every page of LABELLED_ISSUES_QUERY: `{ issues, prs }`, prs empty unless `withPrs`. */
async function labelledIssues({ labels, withPrs, cache }, { cwd }) {
    const issues = []
    let prs = []
    for (let after = null; ; ) {
        const page = await labelledIssuesPage({ labels, after, withPrs, cache }, { cwd })
        issues.push(...page.issues.nodes)
        prs = page.pullRequests?.nodes ?? prs
        if (!page.issues.pageInfo.hasNextPage) {
            return { issues, prs }
        }
        after = page.issues.pageInfo.endCursor
    }
}

const openBlockerNumbers = (issue) => issue.blockedBy.nodes.filter((blocker) => blocker.state === 'OPEN').map((blocker) => blocker.number)

/**
 * Every open issue carrying a factory label, joined with the open PR on its agent branch and the open issues blocking it.
 * This is the factory's whole state on GitHub; run progress lives in .git/factory.
 * `cache` is a gh duration ("60s") during which every caller gets the same answer without asking GitHub again.
 * @returns {Promise<{ number: number, title: string, url: string, state: string, pr: { number: number, url: string, isDraft: boolean } | null, blockedBy: number[] }[]>}
 */
export async function factoryState({ cwd, cache = null }) {
    const trackedLabels = Object.values(LABELS)
    const { issues, prs } = await labelledIssues({ labels: trackedLabels, withPrs: true, cache }, { cwd })
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
                blockedBy: openBlockerNumbers(issue),
            }
        })
        .sort((left, right) => left.number - right.number)
}

/**
 * The merged PR of each of these agent branches, keyed by branch, with the commit it was merged at.
 * One GraphQL call with a field per branch, instead of a search over every agent PR ever merged.
 * @param {string[]} branches
 * @returns {Promise<Map<string, { number: number, headRefOid: string }>>}
 */
export async function mergedAgentPrs(branches, { cwd }) {
    if (branches.length === 0) {
        return new Map()
    }
    const fields = branches.map((_, index) => `b${index}: pullRequests(headRefName: $b${index}, states: MERGED, first: 1, orderBy: { field: UPDATED_AT, direction: DESC }) { nodes { number headRefOid } }`)
    const query = `query($owner: String!, $name: String!, ${branches.map((_, index) => `$b${index}: String!`).join(', ')}) { repository(owner: $owner, name: $name) { ${fields.join(' ')} } }`
    const args = ['api', 'graphql', '-F', 'owner={owner}', '-F', 'name={repo}', '-f', `query=${query}`]
    branches.forEach((branch, index) => args.push('-f', `b${index}=${branch}`))
    const repository = (await ghJson(args, { cwd })).data.repository

    return new Map(branches.flatMap((branch, index) => (repository[`b${index}`].nodes[0] ? [[branch, repository[`b${index}`].nodes[0]]] : [])))
}
