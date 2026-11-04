import assert from "node:assert/strict";
import { test } from "node:test";
import { GH_PROBLEM } from "../herdr/mods/git/gh.js";
import { PR_VIEW, checksOf, loadPr, parseRemote, pickPr } from "../herdr/mods/git/pr-data.js";

const check = (name, status, conclusion, url = `https://ci/${name}`) => ({ __typename: "CheckRun", name, status, conclusion, detailsUrl: url });
const status = (context, state) => ({ __typename: "StatusContext", context, state, targetUrl: `https://ci/${context}` });
const withChecks = (nodes, state = "FAILURE", totalCount = nodes.length) => ({
  commits: { nodes: [{ commit: { statusCheckRollup: { state, contexts: { totalCount, nodes } } } }] },
});

for (const url of ["https://github.com/cli/cli.git", "https://github.com/cli/cli", "git@github.com:cli/cli.git", "ssh://git@github.com/cli/cli.git"]) {
  test(`${url} is a github.com remote`, () => {
    assert.deepEqual(parseRemote(url), { owner: "cli", name: "cli" });
  });
}

for (const url of ["https://gitlab.com/cli/cli.git", "https://evil.example/github.com/cli/cli", "git@ghe.corp:cli/cli.git"]) {
  test(`${url} isn't GitHub`, () => {
    assert.equal(parseRemote(url), null);
  });
}

test("among PRs with this branch name, another owner's is left out and an open one wins", () => {
  // Arrange
  const nodes = [
    { number: 5, state: "OPEN", headRepositoryOwner: { login: "stranger" } },
    { number: 4, state: "MERGED", headRepositoryOwner: { login: "Me" } },
    { number: 3, state: "OPEN", headRepositoryOwner: { login: "me" } },
  ];

  // Act
  const pr = pickPr(nodes, "me");

  // Assert
  assert.equal(pr.number, 3);
});

test("with no open PR, the most recently updated of mine wins; the list arrives in that order", () => {
  // Arrange
  const nodes = [
    { number: 9, state: "CLOSED", headRepositoryOwner: { login: "me" } },
    { number: 4, state: "MERGED", headRepositoryOwner: { login: "me" } },
  ];

  // Act
  const pr = pickPr(nodes, "me");

  // Assert
  assert.equal(pr.number, 9);
});

test("only another owner's PR with this branch name means no PR", () => {
  assert.equal(pickPr([{ number: 5, state: "OPEN", headRepositoryOwner: { login: "stranger" } }], "me"), undefined);
});

test("a deleted fork's PR, with no head owner, doesn't crash the filter", () => {
  assert.equal(pickPr([{ number: 5, state: "CLOSED", headRepositoryOwner: null }], "me"), undefined);
});

test("checks count into failing, pending, passing and skipped, with failing listed first", () => {
  // Arrange
  const pr = withChecks([
    check("build", "COMPLETED", "SUCCESS"),
    check("skip-me", "COMPLETED", "SKIPPED"),
    check("deploy", "IN_PROGRESS", null),
    check("lint", "COMPLETED", "FAILURE"),
    status("coverage", "ERROR"),
    status("legacy", "SUCCESS"),
    status("waiting", "PENDING"),
  ]);

  // Act
  const checks = checksOf(pr);

  // Assert
  assert.deepEqual([checks.fail, checks.pending, checks.pass, checks.skip], [2, 2, 2, 1]);
  assert.deepEqual(checks.list.map((c) => c.name), ["coverage", "lint", "deploy", "waiting", "build", "legacy", "skip-me"]);
});

test("each check keeps the URL of its run page", () => {
  // Arrange
  const pr = withChecks([check("lint", "COMPLETED", "FAILURE", "https://github.com/o/r/runs/1"), status("cov", "ERROR")]);

  // Act
  const { list } = checksOf(pr);

  // Assert
  assert.deepEqual(list.map((c) => c.url), ["https://ci/cov", "https://github.com/o/r/runs/1"]);
});

test("timed out, cancelled and action-required checks count as failing, neutral as passing", () => {
  // Arrange
  const pr = withChecks([
    check("a", "COMPLETED", "TIMED_OUT"), check("b", "COMPLETED", "CANCELLED"),
    check("c", "COMPLETED", "ACTION_REQUIRED"), check("d", "COMPLETED", "NEUTRAL"),
  ]);

  // Act
  const checks = checksOf(pr);

  // Assert
  assert.deepEqual([checks.fail, checks.pass], [3, 1]);
});

test("a commit with no checks has zero of everything", () => {
  // Arrange
  const pr = { commits: { nodes: [{ commit: { statusCheckRollup: null } }] } };

  // Act
  const checks = checksOf(pr);

  // Assert
  assert.deepEqual([checks.total, checks.fail, checks.pending, checks.pass, checks.skip, checks.list.length], [0, 0, 0, 0, 0, 0]);
});

test("more checks than the query fetches are marked as cut off", () => {
  assert.equal(checksOf(withChecks([check("a", "COMPLETED", "SUCCESS")], "SUCCESS", 150)).truncated, true);
});

// A world for loadPr: the repo as git would describe it, and what gh answers.
function repoWorld({ head = "feat/x", remotes = "origin\thttps://github.com/me/repo.git (fetch)\n", branchRemote = "", gh, gitFails = false }) {
  const calls = [];
  const exec = async (command, args, options) => {
    calls.push({ command, args, options });
    if (command === "gh") {
      if (gh instanceof Error) throw gh;
      return gh;
    }
    if (gitFails) return { code: 128, stdout: "", stderr: "fatal: not a git repository" };
    if (args.includes("rev-parse")) return { code: 0, stdout: "/repo\n", stderr: "" };
    if (args.includes("branch")) return { code: 0, stdout: head ? `${head}\n` : "\n", stderr: "" };
    if (args.includes("remote")) return { code: 0, stdout: remotes, stderr: "" };
    return { code: branchRemote ? 0 : 1, stdout: branchRemote, stderr: "" };
  };
  return { exec, calls, ghCalls: () => calls.filter((c) => c.command === "gh") };
}

// What GitHub answers: `open` and `ended` hang off the pushed branch. For a branch
// no longer on GitHub, `authored` is the head owner's PRs by that name and `deleted`
// the base repo's list by name.
const data = ({ open = [], ended = [], authored = [], deleted = [] } = {}) => ({
  head: { ref: { open: { nodes: open }, ended: { nodes: ended } } },
  authored: { nodes: authored },
  base: { ended: { nodes: deleted } },
});
const answer = (lists) => ({ code: 0, stdout: JSON.stringify({ data: data(lists) }), stderr: "" });
const prNode = {
  number: 12, title: "Add it", url: "https://github.com/me/repo/pull/12", state: "OPEN", isDraft: false,
  reviewDecision: "APPROVED", mergeStateStatus: "CLEAN", headRepositoryOwner: { login: "me" },
  ...withChecks([check("lint", "COMPLETED", "FAILURE")]),
};
const at = { cwd: "/repo/sub", on: null };

test("the PR of the branch comes back with its state and checks", async () => {
  // Arrange
  const { exec } = repoWorld({ gh: answer({ open: [prNode] }) });

  // Act
  const view = await loadPr(exec, at, { cache: false });

  // Assert
  assert.equal(view.kind, PR_VIEW.PR);
  assert.equal(view.pr.number, 12);
  assert.equal(view.pr.title, "Add it");
  assert.equal(view.pr.url, "https://github.com/me/repo/pull/12");
  assert.equal(view.pr.state, "OPEN");
  assert.equal(view.pr.review, "APPROVED");
  assert.equal(view.pr.merge, "CLEAN");
  assert.equal(view.pr.checks.fail, 1);
});

test("one view makes one gh call, and only a read", async () => {
  // Arrange
  const { exec, ghCalls } = repoWorld({ gh: answer({ open: [prNode] }) });

  // Act
  await loadPr(exec, at, { cache: true });

  // Assert
  assert.equal(ghCalls().length, 1);
  assert.deepEqual(ghCalls()[0].args.slice(0, 2), ["api", "graphql"]);
  assert.match(ghCalls()[0].args.find((a) => a.startsWith("query=")), /^query=query /);
});

test("a view may use gh's cache", async () => {
  // Arrange
  const { exec, ghCalls } = repoWorld({ gh: answer({}) });

  // Act
  await loadPr(exec, at, { cache: true });

  // Assert
  assert.ok(ghCalls()[0].args.includes("--cache"));
});

test("a refresh after a cd doesn't use gh's cache", async () => {
  // Arrange
  const { exec, ghCalls } = repoWorld({ gh: answer({}) });

  // Act
  await loadPr(exec, at, { cache: false });

  // Assert
  assert.ok(!ghCalls()[0].args.includes("--cache"));
});

test("the query looks in the repo and branch the folder is on", async () => {
  // Arrange
  const { exec, ghCalls } = repoWorld({ gh: answer({}) });

  // Act
  await loadPr(exec, at, { cache: false });

  // Assert
  const { args, options } = ghCalls()[0];
  assert.ok(args.includes("owner=me"));
  assert.ok(args.includes("name=repo"));
  assert.ok(args.includes("branch=feat/x"));
  assert.equal(options.cwd, "/repo");
});

test("a fork's PR is looked up from the branch it pushes to, whatever else upstream has by that name", async () => {
  // Arrange
  const remotes = "origin\tgit@github.com:me/repo.git (fetch)\nupstream\thttps://github.com/big/repo.git (fetch)\n";
  const { exec, ghCalls } = repoWorld({ remotes, gh: answer({ open: [prNode] }) });

  // Act
  const view = await loadPr(exec, at, { cache: false });

  // Assert
  const { args } = ghCalls()[0];
  assert.ok(args.includes("headOwner=me"));
  assert.ok(args.includes("headName=repo"));
  assert.ok(args.includes("ref=refs/heads/feat/x"));
  assert.ok(args.includes("owner=big"));
  assert.equal(view.pr.number, 12);
});

test("an older open PR wins over a newer closed one on the same branch", async () => {
  // Arrange
  const closed = { ...prNode, number: 30, state: "CLOSED" };
  const { exec } = repoWorld({ gh: answer({ open: [prNode], ended: [closed] }) });

  // Act
  const view = await loadPr(exec, at, { cache: false });

  // Assert
  assert.equal(view.pr.number, 12);
});

test("a merged PR whose branch was deleted is still found, among others' by that name", async () => {
  // Arrange
  const stranger = { ...prNode, number: 99, state: "MERGED", headRepositoryOwner: { login: "stranger" } };
  const merged = { ...prNode, number: 40, state: "MERGED" };
  const noBranch = { ...data({ deleted: [stranger, merged] }), head: { ref: null } };
  const { exec } = repoWorld({ gh: { code: 0, stdout: JSON.stringify({ data: noBranch }), stderr: "" } });

  // Act
  const view = await loadPr(exec, at, { cache: false });

  // Assert
  assert.equal(view.pr.number, 40);
});

test("on a busy upstream, a deleted branch's PR is found among the head owner's", async () => {
  // Arrange
  const stranger = { ...prNode, number: 99, state: "MERGED", headRepositoryOwner: { login: "stranger" } };
  const merged = { ...prNode, number: 40, state: "MERGED" };
  const noBranch = { ...data({ authored: [merged], deleted: [stranger] }), head: { ref: null } };
  const { exec, ghCalls } = repoWorld({ gh: { code: 0, stdout: JSON.stringify({ data: noBranch }), stderr: "" } });

  // Act
  const view = await loadPr(exec, at, { cache: false });

  // Assert
  assert.ok(ghCalls()[0].args.includes("authored=repo:me/repo is:pr head:feat/x author:me sort:updated-desc"));
  assert.equal(view.pr.number, 40);
});

test("with the pushed-to repo gone, the base repo's answer still counts", async () => {
  // Arrange: gh exits 1 and prints what it did find
  const merged = { ...prNode, number: 40, state: "MERGED" };
  const stdout = JSON.stringify({ data: { head: null, base: data({ deleted: [merged] }).base }, errors: [{ type: "NOT_FOUND", path: ["head"] }] });
  const { exec } = repoWorld({ gh: { code: 1, stdout, stderr: "gh: Could not resolve to a Repository" } });

  // Act
  const view = await loadPr(exec, at, { cache: false });

  // Assert
  assert.equal(view.pr.number, 40);
});

test("no PR offers the compare page to create one", async () => {
  // Arrange
  const { exec } = repoWorld({ gh: answer({}) });

  // Act
  const view = await loadPr(exec, at, { cache: false });

  // Assert
  assert.equal(view.kind, PR_VIEW.NO_PR);
  assert.equal(view.compareUrl, "https://github.com/me/repo/compare/feat/x?expand=1");
});

test("no PR from a fork compares across owners", async () => {
  // Arrange
  const remotes = "origin\tgit@github.com:me/repo.git (fetch)\nupstream\thttps://github.com/big/repo.git (fetch)\n";
  const { exec } = repoWorld({ remotes, gh: answer({}) });

  // Act
  const view = await loadPr(exec, at, { cache: false });

  // Assert
  assert.equal(view.compareUrl, "https://github.com/big/repo/compare/me:feat/x?expand=1");
});

test("a remote that isn't GitHub is named, with no gh call", async () => {
  // Arrange
  const remotes = "origin\thttps://gitlab.com/me/repo.git (fetch)\n";
  const { exec, ghCalls } = repoWorld({ remotes, gh: answer({}) });

  // Act
  const view = await loadPr(exec, at, { cache: false });

  // Assert
  assert.equal(view.kind, PR_VIEW.NO_GITHUB);
  assert.equal(view.remote, "https://gitlab.com/me/repo.git");
  assert.equal(view.remoteName, "origin");
  assert.equal(ghCalls().length, 0);
});

test("a token inside a remote URL never reaches the view", async () => {
  // Arrange
  const remotes = "origin\thttps://me:s3cret@gitlab.com/me/repo.git (fetch)\n";
  const { exec } = repoWorld({ remotes, gh: answer({}) });

  // Act
  const view = await loadPr(exec, at, { cache: false });

  // Assert
  assert.equal(view.remote, "https://gitlab.com/me/repo.git");
});

test("the branch's own remote decides, over origin", async () => {
  // Arrange
  const remotes = "origin\thttps://gitlab.com/me/repo.git (fetch)\nhub\thttps://github.com/me/repo.git (fetch)\n";
  const { exec, ghCalls } = repoWorld({ remotes, branchRemote: "hub\n", gh: answer({ open: [prNode] }) });

  // Act
  const view = await loadPr(exec, at, { cache: false });

  // Assert
  assert.equal(view.kind, PR_VIEW.PR);
  assert.equal(ghCalls().length, 1);
});

test("a folder outside git says so, with no gh call", async () => {
  // Arrange
  const { exec, ghCalls } = repoWorld({ gitFails: true, gh: answer({}) });

  // Act
  const view = await loadPr(exec, at, { cache: false });

  // Assert
  assert.equal(view.kind, PR_VIEW.NOT_GIT);
  assert.equal(ghCalls().length, 0);
});

test("detached HEAD has no branch to look up", async () => {
  // Arrange
  const { exec, ghCalls } = repoWorld({ head: "", gh: answer({}) });

  // Act
  const view = await loadPr(exec, at, { cache: false });

  // Assert
  assert.equal(view.kind, PR_VIEW.DETACHED);
  assert.equal(ghCalls().length, 0);
});

for (const [what, place, kind] of [
  ["with no folder", { cwd: null, on: null }, PR_VIEW.NO_FOLDER],
  ["on another machine", { cwd: "/x", on: "vps" }, PR_VIEW.REMOTE],
]) {
  test(`a space ${what} makes no call at all`, async () => {
    // Arrange
    const { exec, calls } = repoWorld({ gh: answer({}) });

    // Act
    const view = await loadPr(exec, place, { cache: false });

    // Assert
    assert.equal(view.kind, kind);
    assert.equal(calls.length, 0);
  });
}

for (const [what, gh, problem] of [
  ["gh missing", new Error("not found"), GH_PROBLEM.MISSING],
  ["gh signed out", { code: 4, stdout: "", stderr: "please run: gh auth login" }, GH_PROBLEM.SIGNED_OUT],
]) {
  test(`${what} reaches the view as the problem to fix`, async () => {
    // Arrange
    const { exec } = repoWorld({ gh });

    // Act
    const view = await loadPr(exec, at, { cache: false });

    // Assert
    assert.equal(view.kind, PR_VIEW.GH_PROBLEM);
    assert.equal(view.problem, problem);
  });
}
