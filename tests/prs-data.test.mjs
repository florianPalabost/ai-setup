import assert from "node:assert/strict";
import { test } from "node:test";
import { GH_PROBLEM } from "../herdr/mods/git/gh.js";
import { PRS_VIEW, loadMyPrs } from "../herdr/mods/git/prs-data.js";

// The shape a real `gh api graphql` answer has.
const node = (over = {}) => ({
  number: 1, title: "A PR", url: "https://github.com/me/repo/pull/1", isDraft: false, reviewDecision: null,
  updatedAt: "2026-11-03T21:29:03Z", repository: { nameWithOwner: "me/repo" }, author: { login: "me" },
  commits: { nodes: [{ commit: { statusCheckRollup: { state: "SUCCESS" } } }] },
  ...over,
});
const failingChecks = { commits: { nodes: [{ commit: { statusCheckRollup: { state: "FAILURE" } } }] } };

function fakeGh({ mine = [], review = [], mineCount = mine.length, reviewCount = review.length }) {
  const calls = [];
  const exec = async (program, args) => {
    calls.push({ program, args });
    const data = { mine: { issueCount: mineCount, nodes: mine }, review: { issueCount: reviewCount, nodes: review } };
    return { code: 0, stdout: JSON.stringify({ data }), stderr: "" };
  };
  return { exec, calls };
}

const argValue = (args, name) => args.find((a) => a.startsWith(`${name}=`))?.slice(name.length + 1);
const numbersIn = (view, id) => view.groups.find((g) => g.id === id)?.rows.map((r) => r.number);

test("it asks for my open PRs and direct review requests only", async () => {
  // Arrange
  const { exec, calls } = fakeGh({});

  // Act
  await loadMyPrs(exec, { cache: false });

  // Assert
  const [{ program, args }] = calls;
  assert.equal(calls.length, 1);
  assert.equal(program, "gh");
  assert.match(argValue(args, "mine"), /(^| )is:pr is:open .*(^| )author:@me( |$)/);
  assert.match(argValue(args, "review"), /(^| )is:pr is:open .*(^| )user-review-requested:@me( |$)/);
  assert.doesNotMatch(argValue(args, "review"), /(^| )review-requested:/);
  assert.doesNotMatch(argValue(args, "query"), /mutation/);
});

test("the search isn't limited to one repo", async () => {
  // Arrange
  const { exec, calls } = fakeGh({});

  // Act
  await loadMyPrs(exec, { cache: false });

  // Assert
  assert.doesNotMatch(argValue(calls[0].args, "mine"), /repo:|org:/);
  assert.doesNotMatch(argValue(calls[0].args, "review"), /repo:|org:/);
});

test("gh's cache is used only when the refresh allows it", async () => {
  // Arrange
  const cached = fakeGh({}), fresh = fakeGh({});

  // Act
  await loadMyPrs(cached.exec, { cache: true });
  await loadMyPrs(fresh.exec, { cache: false });

  // Assert
  assert.ok(cached.calls[0].args.includes("--cache"));
  assert.ok(!fresh.calls[0].args.includes("--cache"));
});

test("each PR lands in the group that says whose move it is, in the spec's order", async () => {
  // Arrange
  const gh = fakeGh({
    review: [node({ number: 10 })],
    mine: [
      node({ number: 20, reviewDecision: "CHANGES_REQUESTED" }),
      node({ number: 21, ...failingChecks }),
      node({ number: 30, reviewDecision: "APPROVED" }),
      node({ number: 40, isDraft: true }),
    ],
  });

  // Act
  const view = await loadMyPrs(gh.exec, { cache: false });

  // Assert
  assert.equal(view.kind, PRS_VIEW.LIST);
  assert.deepEqual(view.groups.map((g) => g.title), ["Review requested", "Mine — needs fixing", "Mine — waiting", "Drafts"]);
  assert.deepEqual(numbersIn(view, "review"), [10]);
  assert.deepEqual(numbersIn(view, "fix"), [20, 21]);
  assert.deepEqual(numbersIn(view, "wait"), [30]);
  assert.deepEqual(numbersIn(view, "draft"), [40]);
});

test("a draft with failing checks is a draft, not something to fix", async () => {
  // Arrange
  const gh = fakeGh({ mine: [node({ number: 40, isDraft: true, ...failingChecks })] });

  // Act
  const view = await loadMyPrs(gh.exec, { cache: false });

  // Assert
  assert.deepEqual(view.groups.map((g) => g.id), ["draft"]);
});

test("someone else's draft asking for my review stays a review request", async () => {
  // Arrange
  const gh = fakeGh({ review: [node({ number: 10, isDraft: true })] });

  // Act
  const view = await loadMyPrs(gh.exec, { cache: false });

  // Assert
  assert.deepEqual(view.groups.map((g) => g.id), ["review"]);
});

test("checks that errored count as needing a fix, running ones and no checks don't", async () => {
  // Arrange
  const rollup = (state) => ({ commits: { nodes: [{ commit: { statusCheckRollup: state && { state } } }] } });
  const gh = fakeGh({
    mine: [
      node({ number: 1, ...rollup("ERROR") }),
      node({ number: 2, ...rollup("PENDING") }),
      node({ number: 3, ...rollup(null) }),
      node({ number: 4, commits: { nodes: [] } }),
    ],
  });

  // Act
  const view = await loadMyPrs(gh.exec, { cache: false });

  // Assert
  assert.deepEqual(numbersIn(view, "fix"), [1]);
  assert.deepEqual(numbersIn(view, "wait"), [2, 3, 4]);
});

test("a row carries what the panel draws and opens", async () => {
  // Arrange
  const gh = fakeGh({
    review: [node({
      number: 7, title: "Fix it", url: "https://github.com/o/r/pull/7", reviewDecision: "REVIEW_REQUIRED",
      repository: { nameWithOwner: "o/r" }, author: { login: "marie" },
    })],
  });

  // Act
  const view = await loadMyPrs(gh.exec, { cache: false });

  // Assert
  assert.deepEqual(view.groups[0].rows[0], {
    repo: "o/r", number: 7, title: "Fix it", url: "https://github.com/o/r/pull/7", draft: false,
    review: "REVIEW_REQUIRED", checks: "SUCCESS", author: "marie", updated: Date.parse("2026-11-03T21:29:03Z"),
  });
});

test("a deleted account's PR still lists", async () => {
  // Arrange
  const gh = fakeGh({ review: [node({ number: 7, author: null })] });

  // Act
  const view = await loadMyPrs(gh.exec, { cache: false });

  // Assert
  assert.equal(view.groups[0].rows[0].author, "ghost");
});

test("the total is what GitHub counted, so a long list isn't undercounted", async () => {
  // Arrange
  const gh = fakeGh({ mine: [node({ number: 1 })], review: [node({ number: 2 })], mineCount: 62, reviewCount: 3 });

  // Act
  const view = await loadMyPrs(gh.exec, { cache: false });

  // Assert
  assert.equal(view.total, 65);
  assert.equal(view.shown, 2);
});

test("nothing open gives an empty list, which is an answer and not a problem", async () => {
  // Arrange
  const gh = fakeGh({});

  // Act
  const view = await loadMyPrs(gh.exec, { cache: false });

  // Assert
  assert.deepEqual(view, { kind: PRS_VIEW.LIST, total: 0, shown: 0, groups: [] });
});

test("gh missing or signed out is reported, not shown as an empty list", async () => {
  // Arrange
  const missing = async () => { throw new Error("`herdr.exec`: cannot run gh: No such file or directory"); };
  const signedOut = async () => ({ code: 4, stdout: "", stderr: "To get started with GitHub CLI, please run:  gh auth login" });

  // Act
  const noGh = await loadMyPrs(missing, { cache: false });
  const noLogin = await loadMyPrs(signedOut, { cache: false });

  // Assert
  assert.equal(noGh.kind, PRS_VIEW.GH_PROBLEM);
  assert.equal(noGh.problem, GH_PROBLEM.MISSING);
  assert.equal(noLogin.kind, PRS_VIEW.GH_PROBLEM);
  assert.equal(noLogin.problem, GH_PROBLEM.SIGNED_OUT);
});

test("an answer without the searches is a problem, never 'nothing waiting'", async () => {
  // Arrange
  const exec = async () => ({ code: 0, stdout: '{"data":null}', stderr: "" });

  // Act
  const view = await loadMyPrs(exec, { cache: false });

  // Assert
  assert.equal(view.kind, PRS_VIEW.GH_PROBLEM);
  assert.equal(view.problem, GH_PROBLEM.FAILED);
});
