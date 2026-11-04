// My open PRs and direct review requests, across all of github.com. One GraphQL
// query with two searches. No herdr imports: exec is passed in.
import { GH_PROBLEM, ghGraphql, lastCommitRollup } from "./gh.js";

const FETCHED = 50;
const CACHE_FOR = "30s";
const SEARCH = "is:pr is:open archived:false sort:updated-desc";
const MINE = `${SEARCH} author:@me`;
// Not review-requested: that also counts every team I'm on.
const REVIEW = `${SEARCH} user-review-requested:@me -author:@me`;

const QUERY = `query MyPrs($mine: String!, $review: String!) {
  mine: search(type: ISSUE, query: $mine, first: ${FETCHED}) { issueCount nodes { ...Pr } }
  review: search(type: ISSUE, query: $review, first: ${FETCHED}) { issueCount nodes { ...Pr } }
}
fragment Pr on PullRequest {
  number title url isDraft reviewDecision updatedAt
  repository { nameWithOwner }
  author { login }
  commits(last: 1) { nodes { commit { statusCheckRollup { state } } } }
}`;

// What the section can be showing: `kind` of each result of loadMyPrs.
export const PRS_VIEW = Object.freeze({
  LIST: "list",
  GH_PROBLEM: "gh-problem",
});

const row = (node) => ({
  repo: node.repository.nameWithOwner,
  number: node.number,
  title: node.title,
  url: node.url,
  draft: node.isDraft,
  review: node.reviewDecision ?? null,
  checks: lastCommitRollup(node)?.state ?? null,
  author: node.author?.login ?? "ghost",
  updated: Date.parse(node.updatedAt),
});

const FAILING = new Set(["FAILURE", "ERROR"]);
const needsFixing = (pr) => FAILING.has(pr.checks) || pr.review === "CHANGES_REQUESTED";

// Whose move it is. A group with nothing in it isn't listed.
function groupsOf(mine, review) {
  const ready = mine.filter((pr) => !pr.draft);
  return [
    { id: "review", title: "Review requested", rows: review },
    { id: "fix", title: "Mine — needs fixing", rows: ready.filter(needsFixing) },
    { id: "wait", title: "Mine — waiting", rows: ready.filter((pr) => !needsFixing(pr)) },
    { id: "draft", title: "Drafts", rows: mine.filter((pr) => pr.draft) },
  ].filter((group) => group.rows.length > 0);
}

// One look. Never rejects for an expected state: `kind` says what was found.
export async function loadMyPrs(exec, { cache }) {
  const result = await ghGraphql(exec, { query: QUERY, vars: { mine: MINE, review: REVIEW }, cache: cache ? CACHE_FOR : null });
  if (!result.ok) return { kind: PRS_VIEW.GH_PROBLEM, problem: result.problem, message: result.message };
  const { mine, review } = result.data ?? {};
  if (!mine || !review) return { kind: PRS_VIEW.GH_PROBLEM, problem: GH_PROBLEM.FAILED, message: "the answer had no search results" };

  const mineRows = mine.nodes.map(row), reviewRows = review.nodes.map(row);
  return {
    kind: PRS_VIEW.LIST,
    total: mine.issueCount + review.issueCount,
    shown: mineRows.length + reviewRows.length,
    groups: groupsOf(mineRows, reviewRows),
  };
}
