// What the Pull request section says, and how often it asks again. view is what
// pr-data.js's loadPr returned, or null before the first answer.
import { ghFix } from "./gh.js";
import { PR_VIEW } from "./pr-data.js";

export const REFRESH_PENDING_MS = 60000; // CI pending
export const REFRESH_IDLE_MS = 300000; // otherwise

export const GLYPH = { fail: "✗", pending: "◌", pass: "✓", skip: "⊘" };
const BUCKET_WORD = { fail: "failing", pending: "pending", pass: "passing", skip: "skipped" };
const BUCKETS = Object.keys(BUCKET_WORD);

const REVIEW = { APPROVED: "Approved", CHANGES_REQUESTED: "Changes requested", REVIEW_REQUIRED: "Review required" };
const MERGE = {
  CLEAN: "Ready to merge", BLOCKED: "Blocked", BEHIND: "Behind base", DIRTY: "Conflicts", UNSTABLE: "Checks failing",
  HAS_HOOKS: "Ready to merge", UNKNOWN: "Merge state unknown",
};

export function stateLabel({ state, draft }) {
  if (state === "MERGED") return "Merged";
  if (state === "CLOSED") return "Closed";
  return draft ? "Draft" : "Open";
}

export const reviewLabel = (review) => REVIEW[review] ?? null;

export function mergeLabel({ state, merge }) {
  if (state !== "OPEN" || !merge || merge === "DRAFT") return null;
  return MERGE[merge] ?? merge;
}

export function emptyText(view) {
  switch (view?.kind) {
    case undefined: return "Looking for a PR…";
    case PR_VIEW.NO_PR: return `No PR for ${view.branch}`;
    case PR_VIEW.NOT_GIT: return "Not a git repository";
    case PR_VIEW.DETACHED: return "Detached HEAD: no branch, no PR";
    case PR_VIEW.NO_FOLDER: return "No folder in this space";
    case PR_VIEW.REMOTE: return `Space on ${view.machine}: GitHub data skipped`;
    case PR_VIEW.NO_GITHUB:
      return view.remote ? `No GitHub remote (${view.remoteName}: ${view.remote})` : `No GitHub remote (no "${view.remoteName}" remote)`;
    case PR_VIEW.GH_PROBLEM: return ghFix(view);
    default: return `Couldn't read this folder: ${view.message}`;
  }
}

export function prSummary(view) {
  if (!view) return "";
  if (view.kind === PR_VIEW.NO_PR) return "No PR";
  if (view.kind !== PR_VIEW.PR) return emptyText(view);
  const { pr } = view;
  const counts = BUCKETS.filter((b) => pr.checks[b] > 0).map((b) => `${GLYPH[b]}${pr.checks[b]}`).join(" ");
  const head = `#${pr.number} ${stateLabel(pr)}`;
  return counts ? `${head}  ${counts}` : head;
}

export const checkCounts = (checks) => BUCKETS.map((bucket) => ({ bucket, text: `${checks[bucket]} ${BUCKET_WORD[bucket]}` }));

export function shownChecks(list, showAll) {
  const shown = showAll ? list : list.filter((c) => c.bucket === "fail" || c.bucket === "pending");
  return { shown, hidden: list.length - shown.length };
}

export function prInterval(view) {
  const checks = view?.pr?.checks;
  const pending = checks && (checks.pending > 0 || checks.rollup === "PENDING" || checks.rollup === "EXPECTED");
  return pending ? REFRESH_PENDING_MS : REFRESH_IDLE_MS;
}
