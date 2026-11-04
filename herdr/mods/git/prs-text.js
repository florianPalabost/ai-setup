// What the My PRs & reviews section says, and how often it asks again. view is
// what prs-data.js's loadMyPrs returned, or null before the first answer.
import { ghFix } from "./gh.js";
import { PRS_VIEW } from "./prs-data.js";
import { GLYPH } from "./pr-text.js";

const MINUTE_S = 60, HOUR_S = 3600, DAY_S = 86400;
const MONTH_DAYS = 30, DAYS_BEFORE_MONTHS = 60;

export const PRS_INTERVAL_MS = 300000;

const CHECKS_TONE = { SUCCESS: "pass", FAILURE: "fail", ERROR: "fail", PENDING: "pending", EXPECTED: "pending" };
const REVIEW_WORD = { APPROVED: "approved", CHANGES_REQUESTED: "changes", REVIEW_REQUIRED: "review" };

export function ago(time, now) {
  const seconds = (now - time) / 1000;
  if (seconds < MINUTE_S) return "now";
  if (seconds < HOUR_S) return `${Math.round(seconds / MINUTE_S)}m`;
  if (seconds < DAY_S) return `${Math.round(seconds / HOUR_S)}h`;
  const days = Math.round(seconds / DAY_S);
  return days < DAYS_BEFORE_MONTHS ? `${days}d` : `${Math.round(days / MONTH_DAYS)}mo`;
}

export function since(time, now) {
  const age = ago(time, now);
  return age === "now" ? "just now" : `${age} ago`;
}

const problemText = (view) => (view.kind === PRS_VIEW.GH_PROBLEM ? ghFix(view) : `Couldn't ask GitHub: ${view.message}`);

// The header's text. Nothing at zero: the count is the only thing that calls for attention.
export function prsSummary(view) {
  if (!view) return "";
  if (view.kind !== PRS_VIEW.LIST) return problemText(view);
  return view.total > 0 ? String(view.total) : "";
}

// The body when there are no rows. checkedAt says the empty list is an answer.
export function prsEmptyText(view, checkedAt, now) {
  if (!view) return "Asking GitHub…";
  if (view.kind !== PRS_VIEW.LIST) return problemText(view);
  return `Nothing waiting on you · ${since(checkedAt, now)}`;
}

export const listNote = ({ total, shown }) => (total > shown ? `First ${shown} of ${total}` : null);

export function checksMark(state) {
  const tone = CHECKS_TONE[state];
  return tone ? { glyph: GLYPH[tone], tone } : { glyph: "·", tone: "none" };
}

export const reviewWord = (review) => REVIEW_WORD[review] ?? null;
