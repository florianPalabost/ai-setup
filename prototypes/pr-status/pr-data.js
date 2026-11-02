// PROTOTYPE (wayfinder #6): PR + checks for the branch you're looking at.
// Shared by proto-pr-strip and proto-pr-pane. install.sh copies this file into
// each mod folder (a mod can only import from its own folder).
//
// Data path (decided in #4): local `git` for repo/branch/remotes, then ONE
// `gh api graphql` call per refresh. gh owns auth; the mod never sees a token.

import { spaces, panes, focused, exec, window } from "herdr";

// How to open a URL. "auto": wslview, else explorer.exe on WSL (Windows default
// browser), else xdg-open (detached). Force one to compare: "explorer" | "xdg-open".
export const OPENER = "auto";

const FAST = 60000; // CI pending
const SLOW = 300000; // otherwise
const TICK = 2000; // cheap: only decides whether something is due
const CACHE = "30s"; // gh --cache for timer refreshes (shared by every mod copy)

const QUERY = `query PrForBranch($owner: String!, $name: String!, $branch: String!) {
  repository(owner: $owner, name: $name) {
    pullRequests(headRefName: $branch, first: 10, states: [OPEN, MERGED, CLOSED],
                 orderBy: {field: UPDATED_AT, direction: DESC}) {
      nodes {
        number title url state isDraft reviewDecision mergeStateStatus updatedAt
        headRepositoryOwner { login }
        commits(last: 1) { nodes { commit { statusCheckRollup { state
          contexts(first: 100) { totalCount nodes {
            __typename
            ... on CheckRun { name status conclusion detailsUrl checkSuite { workflowRun { workflow { name } } } }
            ... on StatusContext { context state targetUrl }
          } } } } } }
      }
    }
  }
  rateLimit { cost remaining resetAt }
}`;

// Where you're looking: the focused terminal pane, else the tab's first
// terminal pane with a folder (so focusing a mod pane doesn't lose the repo),
// else the space's folder. Same idea as the shipped `changes` mod's location().
export function location() {
  const space = spaces().find((s) => s.active), f = focused();
  const ps = panes();
  let pane = f?.pane ? ps.find((p) => p.pane === f.pane && p.terminal) : null;
  if (!pane && f?.tab) pane = ps.find((p) => p.tab === f.tab && p.terminal && p.cwd);
  const on = f?.pane === null && f?.terminal?.includes("/") ? f.terminal.split("/")[0] : space?.machine ?? null;
  return { cwd: pane?.cwd || space?.folder || null, on, branch: pane?.branch ?? space?.branch ?? null, space: space?.id ?? null };
}

// github.com remotes only: https, ssh scp-style, ssh://. Host aliases don't match.
export function parseRemote(url) {
  const m = /^(?:https?:\/\/(?:[^@/]+@)?|ssh:\/\/git@|git@)github\.com[:/]([^/]+)\/([^/]+?)(?:\.git)?\/?$/.exec(url.trim());
  return m ? { owner: m[1], name: m[2] } : null;
}

const FAIL = new Set(["FAILURE", "TIMED_OUT", "CANCELLED", "ACTION_REQUIRED", "STARTUP_FAILURE", "STALE", "ERROR"]);
const PASS = new Set(["SUCCESS", "NEUTRAL"]);

function bucket(n) {
  if (n.__typename === "StatusContext") {
    if (n.state === "SUCCESS") return "pass";
    if (n.state === "PENDING" || n.state === "EXPECTED") return "pending";
    return "fail";
  }
  if (n.status !== "COMPLETED") return "pending";
  if (n.conclusion === "SKIPPED") return "skip";
  if (PASS.has(n.conclusion)) return "pass";
  if (FAIL.has(n.conclusion)) return "fail";
  return "pending";
}

const ORDER = { fail: 0, pending: 1, pass: 2, skip: 3 };

function checksOf(pr) {
  const rollup = pr.commits?.nodes?.[0]?.commit?.statusCheckRollup;
  if (!rollup) return { rollup: null, total: 0, fail: 0, pending: 0, pass: 0, skip: 0, list: [], truncated: false };
  const list = rollup.contexts.nodes.map((n) => ({
    name: n.__typename === "CheckRun" ? n.name : n.context,
    workflow: n.checkSuite?.workflowRun?.workflow?.name ?? null,
    url: n.detailsUrl ?? n.targetUrl ?? null,
    bucket: bucket(n),
    raw: n.__typename === "CheckRun" ? (n.conclusion ?? n.status) : n.state,
  })).sort((a, b) => ORDER[a.bucket] - ORDER[b.bucket] || a.name.localeCompare(b.name));
  const count = (b) => list.filter((c) => c.bucket === b).length;
  return { rollup: rollup.state, total: rollup.contexts.totalCount, fail: count("fail"), pending: count("pending"), pass: count("pass"), skip: count("skip"), list, truncated: rollup.contexts.totalCount > list.length };
}

// One look. Returns a state object; `kind` is what the UI switches on.
export async function load(loc, { cache = true } = {}) {
  if (!loc.cwd) return { kind: "no-folder" };
  if (loc.on) return { kind: "remote-machine", machine: loc.on };
  const git = (args) => exec("git", ["--no-optional-locks", ...args], { cwd: loc.cwd });
  const top = await git(["rev-parse", "--show-toplevel", "--abbrev-ref", "HEAD"]);
  if (top.code !== 0) return { kind: "not-git", cwd: loc.cwd };
  const [root, head] = top.stdout.trim().split("\n");
  if (!head || head === "HEAD") return { kind: "detached", root };
  const branch = head;

  // Remotes: where the branch pushes (its configured remote, else origin) gives
  // the head owner; `upstream`, if it's GitHub, is where a fork's PR lives.
  const remotes = {};
  for (const line of (await git(["remote", "-v"])).stdout.split("\n")) {
    const [r, url] = line.split(/\s+/);
    if (r && url) remotes[r] ??= url;
  }
  const pushRemote = (await git(["config", "--get", `branch.${branch}.remote`])).stdout.trim() || "origin";
  const headRepo = remotes[pushRemote] ? parseRemote(remotes[pushRemote]) : null;
  if (!headRepo) return { kind: "no-github", root, branch, remote: remotes[pushRemote] ?? null, remoteName: pushRemote };
  const baseRepo = (remotes.upstream && parseRemote(remotes.upstream)) || headRepo;

  const args = ["api", "graphql", ...(cache ? ["--cache", CACHE] : []),
    "-f", `owner=${baseRepo.owner}`, "-f", `name=${baseRepo.name}`, "-f", `branch=${branch}`, "-f", `query=${QUERY}`];
  const t0 = Date.now();
  const r = await exec("gh", args, { cwd: root });
  const ms = Date.now() - t0;
  const repo = `${baseRepo.owner}/${baseRepo.name}`;
  if (r.code !== 0) return { kind: "error", repo, branch, message: (r.stderr || r.stdout).trim().split("\n")[0] };
  const data = JSON.parse(r.stdout).data;
  const nodes = (data.repository?.pullRequests?.nodes ?? [])
    .filter((n) => n.headRepositoryOwner?.login?.toLowerCase() === headRepo.owner.toLowerCase());
  const pr = nodes.find((n) => n.state === "OPEN") ?? nodes[0];
  const meta = { ms, cost: data.rateLimit?.cost, remaining: data.rateLimit?.remaining };
  if (!pr) return { kind: "no-pr", repo, branch, headOwner: headRepo.owner, meta,
    compareUrl: `https://github.com/${repo}/compare/${baseRepo === headRepo ? "" : `${headRepo.owner}:`}${encodeURIComponent(branch)}?expand=1` };
  return { kind: "pr", repo, branch, meta, pr: {
    number: pr.number, title: pr.title, url: pr.url, state: pr.state, draft: pr.isDraft,
    review: pr.reviewDecision, merge: pr.mergeStateStatus, checks: checksOf(pr) } };
}

// Keeps one state fresh: refreshes when the place/branch changes, when a
// terminal in the shown space goes busy -> idle (a push, `gh pr create`), when
// the window comes back after the data went stale, and on a timer only while
// the window is active and a PR exists (60 s while CI is pending, 5 min else).
export class PrWatcher {
  constructor() {
    this.state = { kind: "loading" };
    this.key = null; this.loc = null; this.at = 0; this.reason = null;
    this.loading = false; this.again = null; this.busy = {}; this.wasActive = true;
  }

  start(cx) {
    this.tick(cx);
    cx.timer.every(TICK, (cx) => this.tick(cx));
  }

  interval() {
    const c = this.state.pr?.checks;
    return c && (c.pending > 0 || c.rollup === "PENDING" || c.rollup === "EXPECTED") ? FAST : SLOW;
  }

  tick(cx) {
    const now = Date.now(), loc = location(), key = JSON.stringify(loc);
    let reason = null;
    if (key !== this.key) {
      this.key = key; this.loc = loc; this.state = { kind: "loading" }; this.at = 0;
      reason = "context"; cx.notify();
    }
    // busy -> idle in the shown space's terminals
    const space = spaces().find((s) => s.active);
    const tabs = new Set((space?.tabs ?? []).map((t) => t.id));
    const busy = {};
    for (const p of panes()) {
      if (!p.terminal || !tabs.has(p.tab)) continue;
      busy[p.pane] = p.status === "working" || !(p.program?.shell || p.program?.agent);
      if (this.busy[p.pane] && !busy[p.pane]) reason ??= "idle";
    }
    this.busy = busy;
    const active = window()?.active ?? true;
    const stale = now - this.at > this.interval();
    if (active && !this.wasActive && stale && this.at) reason ??= "window";
    this.wasActive = active;
    if (active && stale && this.at && this.state.kind === "pr") reason ??= "timer";
    if (reason) this.refresh(cx, reason);
  }

  refresh(cx, reason) {
    if (this.loading) { this.again = reason; return; }
    this.loading = true;
    const key = this.key, loc = this.loc;
    cx.spawn(async (cx) => {
      let next;
      try { next = await load(loc, { cache: reason === "timer" }); }
      catch (e) { next = { kind: "error", message: String(e?.message ?? e) }; }
      this.loading = false;
      if (key !== this.key) return;
      this.at = Date.now(); this.reason = reason;
      const changed = JSON.stringify({ ...next, meta: 0 }) !== JSON.stringify({ ...this.state, meta: 0 });
      this.state = next;
      // Redraw only on change (every redraw redraws the window); the pane's
      // "checked …" line can lag, that's fine for a prototype.
      if (changed || reason === "manual") cx.notify();
      if (this.again) { const r = this.again; this.again = null; this.refresh(cx, r); }
    });
  }
}

export async function openUrl(url) {
  if (!url) return;
  const script = {
    auto: 'if command -v wslview >/dev/null 2>&1; then wslview "$1"; elif grep -qi microsoft /proc/version && command -v explorer.exe >/dev/null 2>&1; then explorer.exe "$1"; else setsid xdg-open "$1" >/dev/null 2>&1 & fi; exit 0',
    explorer: 'explorer.exe "$1"; exit 0', // exits 1 even when it worked
    // xdg-open on WSLg starts Linux Chrome in the foreground and blocks until it
    // exits; exec's 30 s limit would kill it, so detach.
    "xdg-open": 'setsid xdg-open "$1" >/dev/null 2>&1 & exit 0',
  }[OPENER];
  await exec("sh", ["-c", script, "open-url", url]);
}

// Shared look helpers.
export function tones(t) {
  return { pass: t.ansi2, fail: t.ansi1, pending: t.ansi3, skip: t.dim, merged: t.ansi5, open: t.ansi2, closed: t.ansi1, draft: t.dim };
}
export const GLYPH = { pass: "✓", fail: "✗", pending: "◌", skip: "⊘" };
export const SPIN = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

export function stateLabel(pr) {
  if (pr.state === "MERGED") return ["Merged", "merged"];
  if (pr.state === "CLOSED") return ["Closed", "closed"];
  if (pr.draft) return ["Draft", "draft"];
  return ["Open", "open"];
}
export function reviewLabel(review) {
  return { APPROVED: ["✓ Approved", "pass"], CHANGES_REQUESTED: ["✗ Changes requested", "fail"], REVIEW_REQUIRED: ["◌ Review required", "pending"] }[review] ?? null;
}
export function ago(at) {
  if (!at) return "never";
  const s = Math.round((Date.now() - at) / 1000);
  return s < 60 ? `${s}s ago` : `${Math.round(s / 60)}m ago`;
}
// Why there's no PR line, in words.
export function emptyText(s) {
  switch (s.kind) {
    case "loading": return "Looking for a PR…";
    case "no-folder": return "No folder in this space";
    case "remote-machine": return `Space on ${s.machine}: GitHub data skipped`;
    case "not-git": return "Not a git repository";
    case "detached": return "Detached HEAD: no branch, no PR";
    case "no-github": return s.remote ? `No GitHub remote (${s.remoteName}: ${s.remote})` : `No GitHub remote (no "${s.remoteName}" remote)`;
    case "no-pr": return `No PR for ${s.branch}`;
    case "error": return `gh failed: ${s.message}`;
    default: return "";
  }
}
