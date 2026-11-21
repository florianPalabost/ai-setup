import assert from "node:assert/strict";
import { execFileSync, spawn, spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

const FACTORY = new URL("../factory/bin/factory.mjs", import.meta.url).pathname;
const STACK_CONFIG = {
  up: ['echo "up $(basename "$PWD")" >> "$CALLS"'],
  down: ['echo "down $(basename "$PWD")" >> "$CALLS"'],
};

function git(args, cwd) {
  return execFileSync("git", args, { cwd, encoding: "utf8", env: { ...process.env, GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" } });
}

function makeRepo(config, { worktrees = [], gh = "exit 1" } = {}) {
  const dir = mkdtempSync(join(tmpdir(), "factory-stack-"));
  const root = join(dir, "app");
  mkdirSync(root);
  git(["init", "-q", "-b", "main"], root);
  writeFileSync(join(root, ".factory.json"), JSON.stringify(config));
  git(["add", "."], root);
  git(["commit", "-q", "-m", "init"], root);
  worktrees.forEach((number) => mkdirSync(worktreePath(root, number), { recursive: true }));
  const bin = join(dir, "bin");
  mkdirSync(bin);
  writeFileSync(join(bin, "gh"), `#!/bin/sh\n${gh}\n`);
  chmodSync(join(bin, "gh"), 0o755);
  const calls = join(dir, "calls");
  const env = { ...process.env, CALLS: calls, PATH: `${bin}:${process.env.PATH}` };

  return { dir, root, calls, env };
}

const worktreePath = (root, number) => join(`${root}-factory`, `issue-${number}`);
const stackFile = (root) => join(root, ".git", "factory", "stack.json");
const readStack = (root) => JSON.parse(readFileSync(stackFile(root), "utf8"));
const callsOf = (repo) => (existsSync(repo.calls) ? readFileSync(repo.calls, "utf8").trim().split("\n") : []);

function writeStack(root, stack) {
  mkdirSync(join(root, ".git", "factory"), { recursive: true });
  writeFileSync(stackFile(root), JSON.stringify(stack));
}

function factory(repo, args) {
  const result = spawnSync(process.execPath, [FACTORY, ...args, "--repo", repo.root], { env: repo.env, encoding: "utf8" });

  return { status: result.status, output: result.stdout + result.stderr };
}

test("factory up refuses with no_worktree when the ticket has no worktree", (t) => {
  // Arrange
  const repo = makeRepo(STACK_CONFIG);
  t.after(() => rmSync(repo.dir, { recursive: true, force: true }));

  // Act
  const { status, output } = factory(repo, ["up", "7"]);

  // Assert
  assert.equal(status, 1);
  assert.match(output, /\[no_worktree\]/);
  assert.deepEqual(callsOf(repo), []);
});

test("factory up refuses with stack_not_configured when up or down is empty", (t) => {
  // Arrange
  const repo = makeRepo({ up: ["true"] }, { worktrees: [7] });
  t.after(() => rmSync(repo.dir, { recursive: true, force: true }));

  // Act
  const { status, output } = factory(repo, ["up", "7"]);

  // Assert
  assert.equal(status, 1);
  assert.match(output, /\[stack_not_configured\]/);
});

test("with no record, factory up runs down in the main checkout, then up in the worktree, and records it", (t) => {
  // Arrange
  const repo = makeRepo(STACK_CONFIG, { worktrees: [7] });
  t.after(() => rmSync(repo.dir, { recursive: true, force: true }));

  // Act
  const { status, output } = factory(repo, ["up", "7"]);

  // Assert
  assert.equal(status, 0, output);
  assert.deepEqual(callsOf(repo), ["down app", "up issue-7"]);
  const stack = readStack(repo.root);
  assert.equal(stack.checkout, 7);
  assert.equal(stack.path, worktreePath(repo.root, 7));
  assert.ok(!Number.isNaN(Date.parse(stack.since)));
});

test("factory up runs down in the recorded checkout before up in the new one", (t) => {
  // Arrange
  const repo = makeRepo(STACK_CONFIG, { worktrees: [7, 8] });
  t.after(() => rmSync(repo.dir, { recursive: true, force: true }));
  writeStack(repo.root, { checkout: 8, path: worktreePath(repo.root, 8), since: new Date().toISOString() });

  // Act
  const { status } = factory(repo, ["up", "7"]);

  // Assert
  assert.equal(status, 0);
  assert.deepEqual(callsOf(repo), ["down issue-8", "up issue-7"]);
  assert.equal(readStack(repo.root).checkout, 7);
});

test("when the recorded checkout is gone, factory up warns and runs down in the main checkout", (t) => {
  // Arrange
  const repo = makeRepo(STACK_CONFIG, { worktrees: [7] });
  t.after(() => rmSync(repo.dir, { recursive: true, force: true }));
  writeStack(repo.root, { checkout: 8, path: worktreePath(repo.root, 8), since: new Date().toISOString() });

  // Act
  const { status, output } = factory(repo, ["up", "7"]);

  // Assert
  assert.equal(status, 0);
  assert.match(output, /issue-8.*gone/);
  assert.deepEqual(callsOf(repo), ["down app", "up issue-7"]);
});

test("when down fails, factory up stops with command_failed and leaves stack.json as it was", (t) => {
  // Arrange
  const repo = makeRepo({ ...STACK_CONFIG, down: ["exit 3"] }, { worktrees: [7, 8] });
  t.after(() => rmSync(repo.dir, { recursive: true, force: true }));
  const recorded = { checkout: 8, path: worktreePath(repo.root, 8), since: "2026-01-01T00:00:00.000Z" };
  writeStack(repo.root, recorded);

  // Act
  const { status, output } = factory(repo, ["up", "7"]);

  // Assert
  assert.equal(status, 1);
  assert.match(output, /\[command_failed\] down command failed \(exit 3\): exit 3/);
  assert.deepEqual(callsOf(repo), []);
  assert.deepEqual(readStack(repo.root), recorded);
});

test("with --force, factory up carries on with up after a failed down", (t) => {
  // Arrange
  const repo = makeRepo({ ...STACK_CONFIG, down: ["exit 3"] }, { worktrees: [7] });
  t.after(() => rmSync(repo.dir, { recursive: true, force: true }));

  // Act
  const { status } = factory(repo, ["up", "7", "--force"]);

  // Assert
  assert.equal(status, 0);
  assert.deepEqual(callsOf(repo), ["up issue-7"]);
  assert.equal(readStack(repo.root).checkout, 7);
});

test("on the checkout that already has the stack, factory up skips down and runs up again", (t) => {
  // Arrange
  const repo = makeRepo(STACK_CONFIG, { worktrees: [7] });
  t.after(() => rmSync(repo.dir, { recursive: true, force: true }));
  writeStack(repo.root, { checkout: 7, path: worktreePath(repo.root, 7), since: new Date().toISOString() });

  // Act
  const { status } = factory(repo, ["up", "7"]);

  // Assert
  assert.equal(status, 0);
  assert.deepEqual(callsOf(repo), ["up issue-7"]);
});

test("a failing up command stops there, names it, and leaves stack.json on the new checkout", (t) => {
  // Arrange
  const repo = makeRepo({ ...STACK_CONFIG, up: ["exit 1", 'echo "never" >> "$CALLS"'] }, { worktrees: [7] });
  t.after(() => rmSync(repo.dir, { recursive: true, force: true }));

  // Act
  const { status, output } = factory(repo, ["up", "7"]);

  // Assert
  assert.equal(status, 1);
  assert.match(output, /\[command_failed\] up command failed \(exit 1\): exit 1/);
  assert.deepEqual(callsOf(repo), ["down app"]);
  assert.equal(readStack(repo.root).checkout, 7);
});

test("factory up only warns when a run is working in that worktree", (t) => {
  // Arrange
  const repo = makeRepo(STACK_CONFIG, { worktrees: [7] });
  t.after(() => rmSync(repo.dir, { recursive: true, force: true }));
  const runDir = join(repo.root, ".git", "factory", "issue-7", "2026-01-01T00-00-00-000Z");
  mkdirSync(runDir, { recursive: true });
  writeFileSync(join(runDir, "progress.jsonl"), `${JSON.stringify({ at: new Date().toISOString(), step: "run", status: "running", pid: process.pid })}\n`);

  // Act
  const { status, output } = factory(repo, ["up", "7"]);

  // Assert
  assert.equal(status, 0);
  assert.match(output, /a run is working in #7/);
  assert.deepEqual(callsOf(repo), ["down app", "up issue-7"]);
});

test("--no-serve runs up and skips serve", (t) => {
  // Arrange
  const repo = makeRepo({ ...STACK_CONFIG, serve: 'echo serve >> "$CALLS"' }, { worktrees: [7] });
  t.after(() => rmSync(repo.dir, { recursive: true, force: true }));

  // Act
  const { status } = factory(repo, ["up", "7", "--no-serve"]);

  // Assert
  assert.equal(status, 0);
  assert.deepEqual(callsOf(repo), ["down app", "up issue-7"]);
});

test("a serve that fails on its own reports command_failed", (t) => {
  // Arrange
  const repo = makeRepo({ ...STACK_CONFIG, serve: "exit 2" }, { worktrees: [7] });
  t.after(() => rmSync(repo.dir, { recursive: true, force: true }));

  // Act
  const { status, output } = factory(repo, ["up", "7"]);

  // Assert
  assert.equal(status, 1);
  assert.match(output, /\[command_failed\] serve command failed \(exit 2\): exit 2/);
});

test("Ctrl+C on serve leaves the stack up and factory up exits 0", { timeout: 10_000 }, async (t) => {
  // Arrange
  const repo = makeRepo({ ...STACK_CONFIG, serve: 'echo serve >> "$CALLS"; sleep 30' }, { worktrees: [7] });
  t.after(() => rmSync(repo.dir, { recursive: true, force: true }));
  const child = spawn(process.execPath, [FACTORY, "up", "7", "--repo", repo.root], { env: repo.env, detached: true });
  let output = "";
  child.stdout.on("data", (chunk) => (output += chunk));
  child.stderr.on("data", (chunk) => (output += chunk));
  const exited = new Promise((resolve) => child.on("close", resolve));
  while (!callsOf(repo).includes("serve") && child.exitCode === null) {
    await new Promise((resolve) => setTimeout(resolve, 20));
  }

  // Act
  process.kill(-child.pid, "SIGINT");
  const status = await exited;

  // Assert
  assert.equal(status, 0, output);
  assert.match(output, /▸ serve stopped; stack still up in #7 \(factory down to stop it\)/);
  assert.equal(readStack(repo.root).checkout, 7);
  assert.deepEqual(callsOf(repo), ["down app", "up issue-7", "serve"]);
});

test("factory up --main moves the stack back to the main checkout", (t) => {
  // Arrange
  const repo = makeRepo(STACK_CONFIG, { worktrees: [7] });
  t.after(() => rmSync(repo.dir, { recursive: true, force: true }));
  writeStack(repo.root, { checkout: 7, path: worktreePath(repo.root, 7), since: new Date().toISOString() });

  // Act
  const { status } = factory(repo, ["up", "--main"]);

  // Assert
  assert.equal(status, 0);
  assert.deepEqual(callsOf(repo), ["down issue-7", "up app"]);
  assert.deepEqual({ ...readStack(repo.root), since: null }, { checkout: "main", path: repo.root, since: null });
});

test("bare factory up is a usage error", (t) => {
  // Arrange
  const repo = makeRepo(STACK_CONFIG);
  t.after(() => rmSync(repo.dir, { recursive: true, force: true }));

  // Act
  const { status, output } = factory(repo, ["up"]);

  // Assert
  assert.equal(status, 1);
  assert.match(output, /\[usage\]/);
});

test("factory down runs down where the stack is up and clears stack.json", (t) => {
  // Arrange
  const repo = makeRepo(STACK_CONFIG, { worktrees: [7] });
  t.after(() => rmSync(repo.dir, { recursive: true, force: true }));
  writeStack(repo.root, { checkout: 7, path: worktreePath(repo.root, 7), since: new Date().toISOString() });

  // Act
  const { status } = factory(repo, ["down"]);

  // Assert
  assert.equal(status, 0);
  assert.deepEqual(callsOf(repo), ["down issue-7"]);
  assert.equal(existsSync(stackFile(repo.root)), false);
});

test("factory down with no record runs down in the main checkout", (t) => {
  // Arrange
  const repo = makeRepo(STACK_CONFIG);
  t.after(() => rmSync(repo.dir, { recursive: true, force: true }));

  // Act
  const { status } = factory(repo, ["down"]);

  // Assert
  assert.equal(status, 0);
  assert.deepEqual(callsOf(repo), ["down app"]);
});

test("factory status --json --local shows the stack as a top-level key", (t) => {
  // Arrange
  const repo = makeRepo(STACK_CONFIG, { worktrees: [7] });
  t.after(() => rmSync(repo.dir, { recursive: true, force: true }));
  const stack = { checkout: 7, path: worktreePath(repo.root, 7), since: "2026-01-01T14:02:00.000Z" };
  writeStack(repo.root, stack);

  // Act
  const { status, output } = factory(repo, ["status", "--json", "--local"]);

  // Assert
  assert.equal(status, 0);
  assert.deepEqual(JSON.parse(output).stack, stack);
});

test("factory status prints which checkout has the stack at the top", (t) => {
  // Arrange
  const emptyState = '{"data":{"repository":{"issues":{"pageInfo":{"hasNextPage":false},"nodes":[]},"pullRequests":{"nodes":[]}}}}';
  const repo = makeRepo(STACK_CONFIG, { worktrees: [7], gh: `echo '${emptyState}'` });
  t.after(() => rmSync(repo.dir, { recursive: true, force: true }));
  const since = new Date(2026, 0, 1, 14, 2);
  writeStack(repo.root, { checkout: 7, path: worktreePath(repo.root, 7), since: since.toISOString() });

  // Act
  const { status, output } = factory(repo, ["status"]);

  // Assert
  assert.equal(status, 0, output);
  assert.equal(output.split("\n")[0], "stack: #7 (since 14:02)");
});

test("factory doctor flags up without down, and serve without up", (t) => {
  // Arrange
  const repo = makeRepo({ down: ["make down"], serve: "npm run dev" });
  t.after(() => rmSync(repo.dir, { recursive: true, force: true }));

  // Act
  const { output } = factory(repo, ["doctor"]);

  // Assert
  assert.match(output, /✗ .*up and down must be both set or both empty/);
  assert.match(output, /✗ .*serve is set without up/);
});

test("factory clean keeps the worktree that has the stack and removes the other merged ones", (t) => {
  // Arrange
  const repo = makeRepo(STACK_CONFIG);
  t.after(() => rmSync(repo.dir, { recursive: true, force: true }));
  git(["worktree", "add", "-q", "-b", "agent/issue-7", worktreePath(repo.root, 7)], repo.root);
  git(["worktree", "add", "-q", "-b", "agent/issue-8", worktreePath(repo.root, 8)], repo.root);
  const head = git(["rev-parse", "HEAD"], repo.root).trim();
  const merged = JSON.stringify({ number: 1, headRefOid: head });
  writeFileSync(join(repo.dir, "bin", "gh"), `#!/bin/sh\necho '{"data":{"repository":{"b0":{"nodes":[${merged}]},"b1":{"nodes":[${merged}]}}}}'\n`);
  writeStack(repo.root, { checkout: 7, path: worktreePath(repo.root, 7), since: new Date().toISOString() });

  // Act
  const { status, output } = factory(repo, ["clean", "--json"]);

  // Assert
  assert.equal(status, 0, output);
  assert.deepEqual(JSON.parse(output), { removed: [8], kept: [{ issueNumber: 7, reason: "stack is up" }] });
  assert.equal(existsSync(worktreePath(repo.root, 7)), true);
});
