import assert from "node:assert/strict";
import { test } from "node:test";
import { GH_PROBLEM } from "../herdr/mods/git/gh.js";
import { PR_VIEW } from "../herdr/mods/git/pr-data.js";
import { checkCounts, emptyText, mergeLabel, prInterval, prSummary, reviewLabel, shownChecks, stateLabel } from "../herdr/mods/git/pr-text.js";

const MINUTE = 60000;
const checks = (over = {}) => ({ rollup: "SUCCESS", total: 0, fail: 0, pending: 0, pass: 0, skip: 0, list: [], truncated: false, ...over });
const prView = (over = {}, checksOver = {}) => ({
  kind: PR_VIEW.PR,
  pr: { number: 12, title: "Add it", url: "u", state: "OPEN", draft: false, review: null, merge: "CLEAN", checks: checks(checksOver), ...over },
});

test("the state reads Open, Draft, Merged or Closed", () => {
  assert.equal(stateLabel({ state: "OPEN", draft: false }), "Open");
  assert.equal(stateLabel({ state: "OPEN", draft: true }), "Draft");
  assert.equal(stateLabel({ state: "MERGED", draft: false }), "Merged");
  assert.equal(stateLabel({ state: "CLOSED", draft: false }), "Closed");
});

test("the review decision reads in words, and a repo without review rules shows nothing", () => {
  assert.equal(reviewLabel("APPROVED"), "Approved");
  assert.equal(reviewLabel("CHANGES_REQUESTED"), "Changes requested");
  assert.equal(reviewLabel("REVIEW_REQUIRED"), "Review required");
  assert.equal(reviewLabel(null), null);
});

test("the merge state reads in words, only while the PR is open", () => {
  assert.equal(mergeLabel({ state: "OPEN", merge: "DIRTY" }), "Conflicts");
  assert.equal(mergeLabel({ state: "OPEN", merge: "CLEAN" }), "Ready to merge");
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
  assert.equal(prSummary(prView({ state: "MERGED" })), "#12 Merged");
});

test("before any answer the collapsed header is quiet", () => {
  assert.equal(prSummary(null), "");
});

test("without a PR the collapsed header says why", () => {
  assert.equal(prSummary({ kind: PR_VIEW.NO_PR, branch: "feat/x" }), "No PR");
  assert.equal(prSummary({ kind: PR_VIEW.NOT_GIT }), "Not a git repository");
  assert.equal(prSummary({ kind: PR_VIEW.GH_PROBLEM, problem: GH_PROBLEM.SIGNED_OUT }), "gh isn't signed in. Run: gh auth login");
});

test("counts read in full in the open section", () => {
  assert.deepEqual(checkCounts(checks({ fail: 2, pending: 1, pass: 5, skip: 0 })), [
    { bucket: "fail", text: "2 failing" },
    { bucket: "pending", text: "1 pending" },
    { bucket: "pass", text: "5 passing" },
    { bucket: "skip", text: "0 skipped" },
  ]);
});

test("each state without a PR explains itself", () => {
  assert.equal(emptyText(null), "Looking for a PR…");
  assert.equal(emptyText({ kind: PR_VIEW.NO_PR, branch: "feat/x" }), "No PR for feat/x");
  assert.equal(emptyText({ kind: PR_VIEW.NOT_GIT }), "Not a git repository");
  assert.equal(emptyText({ kind: PR_VIEW.DETACHED }), "Detached HEAD: no branch, no PR");
  assert.equal(emptyText({ kind: PR_VIEW.NO_FOLDER }), "No folder in this space");
  assert.equal(emptyText({ kind: PR_VIEW.REMOTE, machine: "vps" }), "Space on vps: GitHub data skipped");
});

test("no GitHub remote names the origin", () => {
  assert.equal(
    emptyText({ kind: PR_VIEW.NO_GITHUB, remoteName: "origin", remote: "https://gitlab.com/me/repo.git" }),
    "No GitHub remote (origin: https://gitlab.com/me/repo.git)",
  );
  assert.equal(emptyText({ kind: PR_VIEW.NO_GITHUB, remoteName: "origin", remote: null }), 'No GitHub remote (no "origin" remote)');
});

test("gh missing or signed out shows the fix, not an empty section", () => {
  assert.match(emptyText({ kind: PR_VIEW.GH_PROBLEM, problem: GH_PROBLEM.MISSING }), /cli\.github\.com/);
  assert.match(emptyText({ kind: PR_VIEW.GH_PROBLEM, problem: GH_PROBLEM.SIGNED_OUT }), /gh auth login/);
});

test("a load that threw still reads as an error", () => {
  assert.equal(emptyText({ kind: "error", message: "no such folder" }), "Couldn't read this folder: no such folder");
});

test("passing and skipped checks stay behind the toggle, failing and pending don't", () => {
  // Arrange
  const list = [
    { name: "lint", bucket: "fail" }, { name: "e2e", bucket: "pending" },
    { name: "build", bucket: "pass" }, { name: "docs", bucket: "skip" },
  ];

  // Act
  const closed = shownChecks(list, false);
  const open = shownChecks(list, true);

  // Assert
  assert.deepEqual(closed.shown.map((c) => c.name), ["lint", "e2e"]);
  assert.equal(closed.hidden, 2);
  assert.deepEqual(open.shown.map((c) => c.name), ["lint", "e2e", "build", "docs"]);
  assert.equal(open.hidden, 0);
});

test("the timer runs each minute while a check is pending", () => {
  assert.equal(prInterval(prView({}, { pending: 1 })), MINUTE);
  assert.equal(prInterval(prView({}, { rollup: "PENDING" })), MINUTE);
  assert.equal(prInterval(prView({}, { rollup: "EXPECTED" })), MINUTE);
});

test("the timer runs every five minutes otherwise", () => {
  assert.equal(prInterval(prView({}, { fail: 1, rollup: "FAILURE" })), 5 * MINUTE);
  assert.equal(prInterval({ kind: PR_VIEW.NO_PR }), 5 * MINUTE);
  assert.equal(prInterval(null), 5 * MINUTE);
});
