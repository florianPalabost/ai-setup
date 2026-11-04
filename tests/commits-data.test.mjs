// What the Commits section reads and says, against real repositories.
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { COMMITS_VIEW, commitsSummary, emptyText, laneWidth, loadCommits } from "../herdr/mods/git/commits-data.js";

const GIT_ENV = { ...process.env, GIT_AUTHOR_NAME: "T", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "T", GIT_COMMITTER_EMAIL: "t@t", GIT_CONFIG_GLOBAL: "/dev/null" };
const FULL_HASH = /^[0-9a-f]{40}$/;

const base = mkdtempSync(join(tmpdir(), "commits-data-test-"));
after(() => rmSync(base, { recursive: true, force: true }));

const git = (cwd, ...args) => execFileSync("git", args, { cwd, env: GIT_ENV, encoding: "utf8" }).trim();
const commit = (cwd, subject) => git(cwd, "commit", "-q", "--allow-empty", "-m", subject);
let repos = 0;

function emptyRepo() {
  const repo = join(base, `repo-${++repos}`);
  git(base, "init", "-q", "-b", "main", repo);
  return repo;
}

function repoOf(...subjects) {
  const repo = emptyRepo();
  subjects.forEach((subject) => commit(repo, subject));
  return repo;
}

const exec = async (program, args, { cwd } = {}) => {
  const result = spawnSync(program, args, { cwd, env: GIT_ENV, encoding: "utf8" });
  return { code: result.status, stdout: result.stdout, stderr: result.stderr };
};
const commitsOf = (view) => view.rows.filter((row) => row.hash);

test("lists the current branch newest first, with full hashes for the Graph tab", async () => {
  // Arrange
  const repo = repoOf("first", "second");

  // Act
  const view = await loadCommits(exec, { cwd: repo });

  // Assert
  assert.equal(view.kind, COMMITS_VIEW.LIST);
  assert.deepEqual(view.rows.map((row) => row.subject), ["second", "first"]);
  assert.equal(view.rows[0].hash, git(repo, "rev-parse", "HEAD"));
  assert.match(view.rows[1].hash, FULL_HASH);
});

test("leaves out commits only other branches have", async () => {
  // Arrange
  const repo = repoOf("shared");
  git(repo, "switch", "-q", "-c", "other");
  commit(repo, "only on other");
  git(repo, "switch", "-q", "main");
  commit(repo, "only on main");

  // Act
  const view = await loadCommits(exec, { cwd: repo });

  // Assert
  assert.deepEqual(commitsOf(view).map((row) => row.subject), ["only on main", "shared"]);
});

test("from a subfolder, names the repository's root", async () => {
  // Arrange
  const repo = repoOf("first"), folder = join(repo, "deep", "down");
  mkdirSync(folder, { recursive: true });

  // Act
  const view = await loadCommits(exec, { cwd: folder });

  // Assert
  assert.equal(view.root, git(repo, "rev-parse", "--show-toplevel"));
});

test("a merge keeps its lanes, and the rows joining them carry no commit", async () => {
  // Arrange
  const repo = repoOf("base");
  git(repo, "switch", "-q", "-c", "side");
  commit(repo, "on side");
  git(repo, "switch", "-q", "main");
  commit(repo, "on main");
  git(repo, "merge", "-q", "--no-ff", "-m", "merge side", "side");

  // Act
  const view = await loadCommits(exec, { cwd: repo });

  // Assert: the order of "on side" and "on main" is git's to choose
  assert.deepEqual(view.rows[0].graph, "*");
  assert.equal(view.rows[0].subject, "merge side");
  assert.equal(view.rows[1].hash, null);
  assert.equal(view.rows[1].graph, "|\\");
  assert.equal(commitsOf(view).length, 4);
  assert.ok(commitsOf(view).some((row) => row.graph === "| *"), "the side commit sits on a second lane");
});

test("a subject holding the field separator stays whole", async () => {
  // Arrange
  const repo = repoOf("left\x1fright");

  // Act
  const view = await loadCommits(exec, { cwd: repo });

  // Assert
  assert.equal(view.rows[0].subject, "left\x1fright");
});

test("colour settings don't leak into the lane column", async () => {
  // Arrange
  const repo = repoOf("first");
  git(repo, "config", "color.ui", "always");

  // Act
  const view = await loadCommits(exec, { cwd: repo });

  // Assert
  assert.equal(view.rows[0].graph, "*");
});

test("stops at a screenful's worth of commits", async () => {
  // Arrange
  const repo = emptyRepo();
  let stream = "";
  for (let i = 1; i <= 60; i++) stream += `commit refs/heads/main\nmark :${i}\ncommitter T <t@t> ${1700000000 + i} +0000\ndata 1\nc\n${i > 1 ? `from :${i - 1}\n` : ""}\n`;
  execFileSync("git", ["fast-import", "--quiet"], { cwd: repo, env: GIT_ENV, input: stream });

  // Act
  const view = await loadCommits(exec, { cwd: repo });

  // Assert
  assert.equal(commitsOf(view).length, 40);
});

test("a folder outside any repository is said to be so", async () => {
  // Arrange
  const folder = join(base, "plain");
  mkdirSync(folder);

  // Act
  const view = await loadCommits(exec, { cwd: folder });

  // Assert
  assert.equal(view.kind, COMMITS_VIEW.NOT_GIT);
});

test("a repository with no commits yet is said to be so, not an error", async () => {
  // Arrange
  const repo = emptyRepo();

  // Act
  const view = await loadCommits(exec, { cwd: repo });

  // Assert
  assert.equal(view.kind, COMMITS_VIEW.NO_COMMITS);
  assert.equal(emptyText(view), "No commits yet");
});

test("a failing log shows git's own message", async () => {
  // Arrange
  const repo = repoOf("first");
  const failingLog = async (program, args, options) => (args.includes("log")
    ? { code: 128, stdout: "", stderr: "fatal: bad object HEAD\nmore\n" }
    : exec(program, args, options));

  // Act
  const view = await loadCommits(failingLog, { cwd: repo });

  // Assert
  assert.equal(view.kind, COMMITS_VIEW.FAILED);
  assert.equal(emptyText(view), "fatal: bad object HEAD");
});

test("git that can't be run is reported, not thrown", async () => {
  // Arrange
  const noGit = async () => { throw new Error("program not found"); };

  // Act
  const view = await loadCommits(noGit, { cwd: "/work" });

  // Assert
  assert.equal(view.kind, COMMITS_VIEW.FAILED);
  assert.equal(emptyText(view), "program not found");
});

test("no folder, or a space on another machine, runs no git at all", async () => {
  // Arrange
  const refuse = async () => { throw new Error("git should not run"); };

  // Act
  const none = await loadCommits(refuse, { cwd: null });
  const remote = await loadCommits(refuse, { cwd: "/work", on: "box" });

  // Assert
  assert.equal(none.kind, COMMITS_VIEW.NO_FOLDER);
  assert.equal(remote.kind, COMMITS_VIEW.REMOTE);
  assert.equal(emptyText(remote), "Space on box: commits skipped");
});

test("the collapsed summary is the newest commit", () => {
  // Arrange
  const view = { kind: COMMITS_VIEW.LIST, rows: [{ hash: "a".repeat(40), short: "aaaaaaa", subject: "newest" }, { hash: "b".repeat(40), short: "bbbbbbb", subject: "older" }] };

  // Act
  const summary = commitsSummary(view);

  // Assert
  assert.equal(summary, "aaaaaaa newest");
});

test("the collapsed summary is blank until the first answer, then says what's wrong", () => {
  assert.equal(commitsSummary(null), "");
  assert.equal(commitsSummary({ kind: COMMITS_VIEW.NOT_GIT }), "Not a git repository");
});

test("the lane column fits its widest row, and stays thin on a tangled history", () => {
  // Arrange
  const straight = [{ graph: "*" }, { graph: "*" }];
  const tangled = [{ graph: "* | | | | | | | | | | | | | | |" }];

  // Act
  const narrow = laneWidth(straight), capped = laneWidth(tangled);

  // Assert: 14 is the floor, 70 the most it takes from the subject
  assert.equal(narrow, 14);
  assert.equal(capped, 70);
});
