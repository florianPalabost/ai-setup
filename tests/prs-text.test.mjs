import assert from "node:assert/strict";
import { test } from "node:test";
import { GH_PROBLEM } from "../herdr/mods/git/gh.js";
import { LOAD_VIEW } from "../herdr/mods/git/shared-result.js";
import { PRS_VIEW } from "../herdr/mods/git/prs-data.js";
import { PRS_INTERVAL_MS, ago, checksMark, listNote, prsEmptyText, prsSummary, reviewWord, since } from "../herdr/mods/git/prs-text.js";

const SECOND = 1000, MINUTE = 60 * SECOND, HOUR = 60 * MINUTE, DAY = 24 * HOUR;
const NOW = 1_000_000_000_000;
const list = (total, shown = total) => ({ kind: PRS_VIEW.LIST, total, shown, groups: [] });
const problem = (kind) => ({ kind: PRS_VIEW.GH_PROBLEM, problem: kind, message: "boom" });

test("the collapsed header gives the count", () => {
  assert.equal(prsSummary(list(3)), "3");
});

test("the collapsed header counts what GitHub counted, not what was fetched", () => {
  assert.equal(prsSummary(list(65, 50)), "65");
});

test("the collapsed header shows nothing at zero", () => {
  assert.equal(prsSummary(list(0)), "");
});

test("before any answer the collapsed header is quiet", () => {
  assert.equal(prsSummary(null), "");
});

test("gh missing or signed out shows the fix in the collapsed header", () => {
  assert.match(prsSummary(problem(GH_PROBLEM.MISSING)), /cli\.github\.com/);
  assert.match(prsSummary(problem(GH_PROBLEM.SIGNED_OUT)), /gh auth login/);
});

test("the empty state reads as checked, and says when", () => {
  assert.equal(prsEmptyText(list(0), NOW - 5 * SECOND, NOW), "Nothing waiting on you · just now");
  assert.equal(prsEmptyText(list(0), NOW - 3 * MINUTE, NOW), "Nothing waiting on you · 3m ago");
});

test("gh missing or signed out shows the fix, not the empty state", () => {
  assert.match(prsEmptyText(problem(GH_PROBLEM.MISSING), NOW, NOW), /cli\.github\.com/);
  assert.match(prsEmptyText(problem(GH_PROBLEM.SIGNED_OUT), NOW, NOW), /gh auth login/);
  assert.equal(prsEmptyText(problem(GH_PROBLEM.FAILED), NOW, NOW), "gh failed: boom");
});

test("before any answer it says it's asking, not that nothing is waiting", () => {
  assert.equal(prsEmptyText(null, 0, NOW), "Asking GitHub…");
});

test("a load that threw reads as an error", () => {
  assert.equal(prsEmptyText({ kind: LOAD_VIEW.ERROR, message: "boom" }, NOW, NOW), "Couldn't ask GitHub: boom");
  assert.equal(prsSummary({ kind: LOAD_VIEW.ERROR, message: "boom" }), "Couldn't ask GitHub: boom");
});

test("a list cut short says so, and a whole one says nothing", () => {
  assert.equal(listNote(list(65, 50)), "First 50 of 65");
  assert.equal(listNote(list(3)), null);
});

test("age reads short, from now up to months", () => {
  assert.equal(ago(NOW - 30 * SECOND, NOW), "now");
  assert.equal(ago(NOW - 5 * MINUTE, NOW), "5m");
  assert.equal(ago(NOW - 3 * HOUR, NOW), "3h");
  assert.equal(ago(NOW - 9 * DAY, NOW), "9d");
  assert.equal(ago(NOW - 90 * DAY, NOW), "3mo");
});

test("a time reads in words", () => {
  assert.equal(since(NOW - 30 * SECOND, NOW), "just now");
  assert.equal(since(NOW - 2 * HOUR, NOW), "2h ago");
});

test("each checks state has its mark and tone, and no checks stays quiet", () => {
  assert.deepEqual(checksMark("SUCCESS"), { glyph: "✓", tone: "pass" });
  assert.deepEqual(checksMark("FAILURE"), { glyph: "✗", tone: "fail" });
  assert.deepEqual(checksMark("ERROR"), { glyph: "✗", tone: "fail" });
  assert.deepEqual(checksMark("PENDING"), { glyph: "◌", tone: "pending" });
  assert.deepEqual(checksMark("EXPECTED"), { glyph: "◌", tone: "pending" });
  assert.deepEqual(checksMark(null), { glyph: "·", tone: "none" });
});

test("the review decision reads in one word, and none shows nothing", () => {
  assert.equal(reviewWord("APPROVED"), "approved");
  assert.equal(reviewWord("CHANGES_REQUESTED"), "changes");
  assert.equal(reviewWord("REVIEW_REQUIRED"), "review");
  assert.equal(reviewWord(null), null);
});

test("the list refreshes every five minutes", () => {
  assert.equal(PRS_INTERVAL_MS, 5 * MINUTE);
});
