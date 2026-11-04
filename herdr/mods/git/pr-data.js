// The PR of the shown space's branch. Local git finds the repo and branch, then
// one GraphQL query fetches the PR and its checks. No herdr imports: exec is passed in.
import { ghGraphql } from "./gh.js";

const CHECKS_FETCHED = 100;
const CACHE_FOR = "30s"; // Under the shortest timer, and shared by every mod copy.

const QUERY = `query PrForBranch($owner: String!, $name: String!, $branch: String!) {
  repository(owner: $owner, name: $name) {
    pullRequests(headRefName: $branch, first: 10, states: [OPEN, MERGED, CLOSED],
                 orderBy: {field: UPDATED_AT, direction: DESC}) {
      nodes {
        number title url state isDraft reviewDecision mergeStateStatus
        headRepositoryOwner { login }
        commits(last: 1) { nodes { commit { statusCheckRollup { state
          contexts(first: ${CHECKS_FETCHED}) { totalCount nodes {
            __typename
            ... on CheckRun { name status conclusion detailsUrl }
            ... on StatusContext { context state targetUrl }
          } } } } } }
      }
    }
  }
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

// Where the person is looking, from herdr's live data. A focused mod pane keeps
// the tab's first terminal, so clicking the panel doesn't lose the repo.
export function locate({ spaces, focused, panes }) {
  const space = spaces.find((s) => s.active);
  let pane = focused?.pane ? panes.find((p) => p.pane === focused.pane && p.terminal) : null;
  if (!pane && focused?.pane) pane = panes.find((p) => p.tab === focused.tab && p.terminal && p.cwd);
  const blockMachine = focused?.pane === null && focused.terminal?.includes("/") ? focused.terminal.split("/")[0] : null;
  return {
    cwd: pane?.cwd || focused?.cwd || space?.folder || null,
    on: blockMachine ?? space?.machine ?? null,
    branch: pane?.branch ?? space?.branch ?? null,
  };
}

// github.com only: https, scp-style and ssh://. A host alias doesn't match.
export function parseRemote(url) {
  const match = /^(?:https?:\/\/(?:[^@/]+@)?|ssh:\/\/git@|git@)github\.com[:/]([^/]+)\/([^/]+?)(?:\.git)?\/?$/.exec(url.trim());
  return match ? { owner: match[1], name: match[2] } : null;
}

const withoutCredentials = (url) => url.replace(/^([a-z+]+:\/\/)[^@/]+@/i, "$1");

// A branch name alone matches other people's forks too. The list arrives most
// recently updated first.
export function pickPr(nodes, headOwner) {
  const mine = nodes.filter((n) => n.headRepositoryOwner?.login?.toLowerCase() === headOwner.toLowerCase());
  return mine.find((n) => n.state === "OPEN") ?? mine[0];
}

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
    vars: { owner: base.owner, name: base.name, branch },
  });
  if (!result.ok) return { kind: PR_VIEW.GH_PROBLEM, problem: result.problem, message: result.message };

  const pr = pickPr(result.data?.repository?.pullRequests?.nodes ?? [], head.owner);
  if (!pr) return { kind: PR_VIEW.NO_PR, branch, compareUrl: compareUrl(base, head, branch) };
  return {
    kind: PR_VIEW.PR,
    pr: {
      number: pr.number, title: pr.title, url: pr.url, state: pr.state, draft: pr.isDraft,
      review: pr.reviewDecision, merge: pr.mergeStateStatus, checks: checksOf(pr),
    },
  };
}
