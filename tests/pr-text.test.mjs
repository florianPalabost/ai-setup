import assert from "node:assert/strict";
import { test } from "node:test";
import { GH_PROBLEM } from "../herdr/mods/git/gh.js";
import { LOAD_VIEW } from "../herdr/mods/git/shared-result.js";
import { PR_VIEW } from "../herdr/mods/git/pr-data.js";
import { checkCounts, emptyText, mergeLabel, prInterval, prSummary, reviewLabel, shownChecks, stateLabel } from "../herdr/mods/git/pr-text.js";

const MINUTE = 60000;
const checks = (over = {}) => ({ rollup: "SUCCESS", total: 0, fail: 0, pending: 0, pass: 0, skip: 0, list: [], truncated: false, ...over });
const prView = (over = {}, checksOver = {}) => ({
  kind: PR_VIEW.PR,
  pr: { number: 12, title: "Add it", url: "u", state: "OPEN", draft: false, review: null, merge: "CLEAN", checks: checks(checksOver), ...over },
});

for (const [state, draft, label] of [["OPEN", false, "Open"], ["OPEN", true, "Draft"], ["MERGED", false, "Merged"], ["CLOSED", false, "Closed"]]) {
  test(`state ${state}, draft ${draft}, reads ${label}`, () => {
    assert.equal(stateLabel({ state, draft }), label);
  });
}

for (const [review, label] of [["APPROVED", "Approved"], ["CHANGES_REQUESTED", "Changes requested"], ["REVIEW_REQUIRED", "Review required"], [null, null]]) {
  test(`review decision ${review} reads ${label}`, () => {
    assert.equal(reviewLabel(review), label);
  });
}

for (const [merge, label] of [["DIRTY", "Conflicts"], ["CLEAN", "Ready to merge"]]) {
  test(`merge state ${merge} reads ${label} while the PR is open`, () => {
    assert.equal(mergeLabel({ state: "OPEN", merge }), label);
  });
}

test("the merge state says nothing once the PR is merged", () => {
  assert.equal(mergeLabel({ state: "MERGED", merge: "CLEAN" }), null);
});

test("a draft's merge state isn't said twice", () => {
  assert.equal(mergeLabel({ state: "OPEN", merge: "DRAFT" }), null);
});

test("an unknown merge state shows as GitHub names it", () => {
  assert.equal(mergeLabel({ state: "OPEN", merge: "SOMETHING_NEW" }), "SOMETHING_NEW");
});

test("the collapsed header gives number, state and check counts", () => {
  // Arrange
  const view = prView({}, { total: 9, fail: 2, pending: 1, pass: 5, skip: 1 });

  // Act
  const summary = prSummary(view);

  // Assert
  assert.equal(summary, "#12 Open  ✗2 ◌1 ✓5 ⊘1");
});

test("the collapsed header leaves out counts at zero", () => {
  assert.equal(prSummary(prView({}, { total: 3, pass: 3 })), "#12 Open  ✓3");
});

test("the collapsed header of a PR with no checks has no counts", () => {
  assert.equal(prSummary(prView({ state: "MERGED" })), "#12 Merged");
});

test("before any answer the collapsed header is quiet", () => {
  assert.equal(prSummary(null), "");
});

for (const [view, summary] of [
  [{ kind: PR_VIEW.NO_PR, branch: "feat/x" }, "No PR"],
  [{ kind: PR_VIEW.NOT_GIT }, "Not a git repository"],
  [{ kind: PR_VIEW.GH_PROBLEM, problem: GH_PROBLEM.SIGNED_OUT }, "gh isn't signed in. Run: gh auth login"],
]) {
  test(`without a PR (${view.kind}) the collapsed header says why`, () => {
    assert.equal(prSummary(view), summary);
  });
}

test("counts read in full in the open section", () => {
  assert.deepEqual(checkCounts(checks({ fail: 2, pending: 1, pass: 5, skip: 0 })), [
    { bucket: "fail", text: "2 failing" },
    { bucket: "pending", text: "1 pending" },
    { bucket: "pass", text: "5 passing" },
    { bucket: "skip", text: "0 skipped" },
  ]);
});

test("before any answer it says it's looking", () => {
  assert.equal(emptyText(null), "Looking for a PR…");
});

for (const [view, text] of [
  [{ kind: PR_VIEW.NO_PR, branch: "feat/x" }, "No PR for feat/x"],
  [{ kind: PR_VIEW.NOT_GIT }, "Not a git repository"],
  [{ kind: PR_VIEW.DETACHED }, "Detached HEAD: no branch, no PR"],
  [{ kind: PR_VIEW.NO_FOLDER }, "No folder in this space"],
  [{ kind: PR_VIEW.REMOTE, machine: "vps" }, "Space on vps: GitHub data skipped"],
]) {
  test(`${view.kind} explains itself`, () => {
    assert.equal(emptyText(view), text);
  });
}

test("no GitHub remote names the origin", () => {
  const view = { kind: PR_VIEW.NO_GITHUB, remoteName: "origin", remote: "https://gitlab.com/me/repo.git" };

  assert.equal(emptyText(view), "No GitHub remote (origin: https://gitlab.com/me/repo.git)");
});

test("no remote at all names the one it looked for", () => {
  assert.equal(emptyText({ kind: PR_VIEW.NO_GITHUB, remoteName: "origin", remote: null }), 'No GitHub remote (no "origin" remote)');
});

for (const [problem, fix] of [[GH_PROBLEM.MISSING, /cli\.github\.com/], [GH_PROBLEM.SIGNED_OUT, /gh auth login/]]) {
  test(`${problem} shows the fix, not an empty section`, () => {
    assert.match(emptyText({ kind: PR_VIEW.GH_PROBLEM, problem }), fix);
  });
}

test("a load that threw still reads as an error", () => {
  assert.equal(emptyText({ kind: LOAD_VIEW.ERROR, message: "no such folder" }), "Couldn't read this folder: no such folder");
});

const CHECK_LIST = [
  { name: "lint", bucket: "fail" }, { name: "e2e", bucket: "pending" },
  { name: "build", bucket: "pass" }, { name: "docs", bucket: "skip" },
];

test("passing and skipped checks stay behind the toggle, failing and pending don't", () => {
  // Act
  const { shown, hidden } = shownChecks(CHECK_LIST, false);

  // Assert
  assert.deepEqual(shown.map((c) => c.name), ["lint", "e2e"]);
  assert.equal(hidden, 2);
});

test("the toggle shows every check", () => {
  // Act
  const { shown, hidden } = shownChecks(CHECK_LIST, true);

  // Assert
  assert.deepEqual(shown.map((c) => c.name), ["lint", "e2e", "build", "docs"]);
  assert.equal(hidden, 0);
});

for (const [why, checksOver] of [["a pending check", { pending: 1 }], ["a pending rollup", { rollup: "PENDING" }], ["an expected rollup", { rollup: "EXPECTED" }]]) {
  test(`the timer runs each minute with ${why}`, () => {
    assert.equal(prInterval(prView({}, checksOver)), MINUTE);
  });
}

for (const [why, view] of [["failed checks", prView({}, { fail: 1, rollup: "FAILURE" })], ["no PR", { kind: PR_VIEW.NO_PR }], ["no answer yet", null]]) {
  test(`the timer runs every five minutes with ${why}`, () => {
    assert.equal(prInterval(view), 5 * MINUTE);
  });
}
