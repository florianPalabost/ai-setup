// The PR of the shown space's branch. Local git finds the repo and branch, then
// one GraphQL query fetches the PR and its checks. No herdr imports: exec is passed in.
import { ghGraphql } from "./gh.js";

const CHECKS_FETCHED = 100;
const CACHE_FOR = "30s"; // Under the shortest timer, and shared by every mod copy.

const LIST_FETCHED = 10;

// Asked from the pushed branch, so nobody else's PR with that name can crowd ours
// out: a busy upstream has hundreds called patch-1. A branch deleted after its PR
// ended has no ref left, so two lists cover that: the head owner's PRs by that name,
// and the base repo's latest by name, for an organisation's branch someone else
// opened the PR from. A longer list with checks makes GitHub answer HTTP 502.
const QUERY = `query PrForBranch($owner: String!, $name: String!, $branch: String!, $headOwner: String!, $headName: String!, $ref: String!, $authored: String!) {
  head: repository(owner: $headOwner, name: $headName) {
    ref(qualifiedName: $ref) {
      open: associatedPullRequests(states: [OPEN], first: ${LIST_FETCHED}, orderBy: {field: UPDATED_AT, direction: DESC}) { nodes { ...Pr } }
      ended: associatedPullRequests(states: [MERGED, CLOSED], first: ${LIST_FETCHED}, orderBy: {field: UPDATED_AT, direction: DESC}) { nodes { ...Pr } }
    }
  }
  authored: search(type: ISSUE, query: $authored, first: ${LIST_FETCHED}) { nodes { ...Pr } }
  base: repository(owner: $owner, name: $name) {
    ended: pullRequests(headRefName: $branch, states: [MERGED, CLOSED], first: ${LIST_FETCHED}, orderBy: {field: UPDATED_AT, direction: DESC}) { nodes { ...Pr } }
  }
}
fragment Pr on PullRequest {
  number title url state isDraft reviewDecision mergeStateStatus
  headRepositoryOwner { login }
  commits(last: 1) { nodes { commit { statusCheckRollup { state
    contexts(first: ${CHECKS_FETCHED}) { totalCount nodes {
      __typename
      ... on CheckRun { name status conclusion detailsUrl }
      ... on StatusContext { context state targetUrl }
    } } } } } }
}`;

// What the section can be showing: `kind` of each result of loadPr.
export const PR_VIEW = Object.freeze({
  PR: "pr",
  NO_PR: "no-pr",
  NO_GITHUB: "no-github",
  NOT_GIT: "not-git",
  DETACHED: "detached",
  NO_FOLDER: "no-folder",
  REMOTE: "remote-machine",
  GH_PROBLEM: "gh-problem",
});

// github.com only: https, scp-style and ssh://. A host alias doesn't match.
export function parseRemote(url) {
  const match = /^(?:https?:\/\/(?:[^@/]+@)?|ssh:\/\/git@|git@)github\.com[:/]([^/]+)\/([^/]+?)(?:\.git)?\/?$/.exec(url.trim());
  return match ? { owner: match[1], name: match[2] } : null;
}

const withoutCredentials = (url) => url.replace(/^([a-z+]+:\/\/)[^@/]+@/i, "$1");

// A branch name alone matches other people's forks too. Each list arrives most
// recently updated first, and those on the pushed branch come ahead of the others.
export function pickPr(nodes, headOwner) {
  const mine = nodes.filter((n) => n.headRepositoryOwner?.login?.toLowerCase() === headOwner.toLowerCase());
  return mine.find((n) => n.state === "OPEN") ?? mine[0];
}

const candidates = ({ head, authored, base }) => [head?.ref?.open, head?.ref?.ended, authored, base?.ended].flatMap((list) => list?.nodes ?? []);

const FAILING = new Set(["FAILURE", "TIMED_OUT", "CANCELLED", "ACTION_REQUIRED", "STARTUP_FAILURE", "STALE", "ERROR"]);
const PASSING = new Set(["SUCCESS", "NEUTRAL"]);
const BUCKET_ORDER = { fail: 0, pending: 1, pass: 2, skip: 3 };

function bucket(node) {
  if (node.__typename === "StatusContext") {
    if (node.state === "SUCCESS") return "pass";
    return node.state === "PENDING" || node.state === "EXPECTED" ? "pending" : "fail";
  }
  if (node.status !== "COMPLETED") return "pending";
  if (node.conclusion === "SKIPPED") return "skip";
  if (PASSING.has(node.conclusion)) return "pass";
  return FAILING.has(node.conclusion) ? "fail" : "pending";
}

export function checksOf(pr) {
  const rollup = pr.commits?.nodes?.[0]?.commit?.statusCheckRollup;
  const nodes = rollup?.contexts?.nodes ?? [];
  const list = nodes
    .map((n) => ({ name: n.name ?? n.context, url: n.detailsUrl ?? n.targetUrl ?? null, bucket: bucket(n) }))
    .sort((a, b) => BUCKET_ORDER[a.bucket] - BUCKET_ORDER[b.bucket] || a.name.localeCompare(b.name));
  const count = (name) => list.filter((c) => c.bucket === name).length;
  const total = rollup?.contexts?.totalCount ?? 0;
  return {
    rollup: rollup?.state ?? null, total, list, truncated: total > list.length,
    fail: count("fail"), pending: count("pending"), pass: count("pass"), skip: count("skip"),
  };
}

const compareUrl = (base, head, branch) => {
  const ref = branch.split("/").map(encodeURIComponent).join("/");
  const from = base.owner === head.owner ? "" : `${head.owner}:`;
  return `https://github.com/${base.owner}/${base.name}/compare/${from}${ref}?expand=1`;
};

// One look. Never rejects for an expected state: `kind` says what was found.
export async function loadPr(exec, { cwd, on }, { cache }) {
  if (on) return { kind: PR_VIEW.REMOTE, machine: on };
  if (!cwd) return { kind: PR_VIEW.NO_FOLDER };
  const git = (args) => exec("git", ["--no-optional-locks", ...args], { cwd });

  const top = await git(["rev-parse", "--show-toplevel"]);
  if (top.code !== 0) return { kind: PR_VIEW.NOT_GIT };
  const root = top.stdout.trim();
  // Also names the branch of a repo with no commits yet.
  const branch = (await git(["branch", "--show-current"])).stdout.trim();
  if (!branch) return { kind: PR_VIEW.DETACHED };

  // Where the branch pushes names the head owner. `upstream`, if it's GitHub,
  // is where a fork's PR lives.
  const remotes = {};
  for (const line of (await git(["remote", "-v"])).stdout.split("\n")) {
    const [name, url] = line.split(/\s+/);
    if (name && url) remotes[name] ??= url;
  }
  const remoteName = (await git(["config", "--get", `branch.${branch}.remote`])).stdout.trim() || "origin";
  const head = remotes[remoteName] ? parseRemote(remotes[remoteName]) : null;
  if (!head) return { kind: PR_VIEW.NO_GITHUB, remoteName, remote: remotes[remoteName] ? withoutCredentials(remotes[remoteName]) : null };
  const base = (remotes.upstream && parseRemote(remotes.upstream)) || head;

  const result = await ghGraphql(exec, {
    query: QUERY, cwd: root, cache: cache ? CACHE_FOR : null,
    vars: {
      owner: base.owner, name: base.name, branch, headOwner: head.owner, headName: head.name, ref: `refs/heads/${branch}`,
      authored: `repo:${base.owner}/${base.name} is:pr head:${branch} author:${head.owner} sort:updated-desc`,
    },
  });
  if (!result.ok) return { kind: PR_VIEW.GH_PROBLEM, problem: result.problem, message: result.message };

  const pr = pickPr(candidates(result.data ?? {}), head.owner);
  if (!pr) return { kind: PR_VIEW.NO_PR, branch, compareUrl: compareUrl(base, head, branch) };
  return {
    kind: PR_VIEW.PR,
    pr: {
      number: pr.number, title: pr.title, url: pr.url, state: pr.state, draft: pr.isDraft,
      review: pr.reviewDecision, merge: pr.mergeStateStatus, checks: checksOf(pr),
    },
  };
}
