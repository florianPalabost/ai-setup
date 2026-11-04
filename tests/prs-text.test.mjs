import assert from "node:assert/strict";
import { test } from "node:test";
import { GH_PROBLEM } from "../herdr/mods/git/gh.js";
import { LOAD_VIEW } from "../herdr/mods/git/shared-result.js";
import { PRS_VIEW } from "../herdr/mods/git/prs-data.js";
import { ago, checksMark, listNote, prsEmptyText, prsInterval, prsSummary, reviewWord, since } from "../herdr/mods/git/prs-text.js";

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

for (const [kind, fix] of [[GH_PROBLEM.MISSING, /cli\.github\.com/], [GH_PROBLEM.SIGNED_OUT, /gh auth login/]]) {
  test(`${kind} shows the fix in the collapsed header`, () => {
    assert.match(prsSummary(problem(kind)), fix);
  });

  test(`${kind} shows the fix, not the empty state`, () => {
    assert.match(prsEmptyText(problem(kind), NOW, NOW), fix);
  });
}

test("a failed call shows what gh said, not the empty state", () => {
  assert.equal(prsEmptyText(problem(GH_PROBLEM.FAILED), NOW, NOW), "gh failed: boom");
});

test("the empty state reads as checked just now", () => {
  assert.equal(prsEmptyText(list(0), NOW - 5 * SECOND, NOW), "Nothing waiting on you · just now");
});

test("the empty state says how long ago it checked", () => {
  assert.equal(prsEmptyText(list(0), NOW - 3 * MINUTE, NOW), "Nothing waiting on you · 3m ago");
});

test("before any answer it says it's asking, not that nothing is waiting", () => {
  assert.equal(prsEmptyText(null, 0, NOW), "Asking GitHub…");
});

test("a load that threw reads as an error in the body", () => {
  assert.equal(prsEmptyText({ kind: LOAD_VIEW.ERROR, message: "boom" }, NOW, NOW), "Couldn't ask GitHub: boom");
});

test("a load that threw reads as an error in the collapsed header", () => {
  assert.equal(prsSummary({ kind: LOAD_VIEW.ERROR, message: "boom" }), "Couldn't ask GitHub: boom");
});

test("a list cut short says so", () => {
  assert.equal(listNote(list(65, 50)), "First 50 of 65");
});

test("a whole list says nothing", () => {
  assert.equal(listNote(list(3)), null);
});

for (const [age, text] of [[30 * SECOND, "now"], [5 * MINUTE, "5m"], [3 * HOUR, "3h"], [9 * DAY, "9d"], [90 * DAY, "3mo"]]) {
  test(`an age of ${age} ms reads ${text}`, () => {
    assert.equal(ago(NOW - age, NOW), text);
  });
}

for (const [age, text] of [[30 * SECOND, "just now"], [2 * HOUR, "2h ago"]]) {
  test(`a time ${age} ms ago reads "${text}"`, () => {
    assert.equal(since(NOW - age, NOW), text);
  });
}

for (const [state, mark] of [
  ["SUCCESS", { glyph: "✓", tone: "pass" }],
  ["FAILURE", { glyph: "✗", tone: "fail" }],
  ["ERROR", { glyph: "✗", tone: "fail" }],
  ["PENDING", { glyph: "◌", tone: "pending" }],
  ["EXPECTED", { glyph: "◌", tone: "pending" }],
  [null, { glyph: "·", tone: "none" }],
]) {
  test(`checks state ${state} shows ${mark.glyph}`, () => {
    assert.deepEqual(checksMark(state), mark);
  });
}

for (const [review, word] of [["APPROVED", "approved"], ["CHANGES_REQUESTED", "changes"], ["REVIEW_REQUIRED", "review"], [null, null]]) {
  test(`review decision ${review} reads ${word}`, () => {
    assert.equal(reviewWord(review), word);
  });
}

const withChecks = (checks) => ({ ...list(1), groups: [{ id: "wait", rows: [{ checks }] }] });

test("the timer runs each minute while any row's checks are pending", () => {
  assert.equal(prsInterval(withChecks("PENDING")), MINUTE);
});

test("the timer treats expected checks as pending", () => {
  assert.equal(prsInterval(withChecks("EXPECTED")), MINUTE);
});

test("the timer runs every five minutes with nothing pending", () => {
  assert.equal(prsInterval(withChecks("FAILURE")), 5 * MINUTE);
});

test("the timer runs every five minutes before any answer", () => {
  assert.equal(prsInterval(null), 5 * MINUTE);
});

test("the timer runs every five minutes after a problem", () => {
  assert.equal(prsInterval(problem(GH_PROBLEM.SIGNED_OUT)), 5 * MINUTE);
});
