// The Commits section in a fake herdr, on real repositories, with clicks going
// through to the real Graph tab.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, beforeEach, test } from "node:test";
import { fakeCx, findById, textOf, walk } from "./fakes/mod-view.mjs";
import * as herdr from "./fakes/herdr-module.mjs";

const { world, resetWorld } = herdr;
const { commits } = await import("../herdr/mods/git/commits-section.js");
const { default: GitGraph } = await import("../herdr/mods/git-graph/main.js");

// Fixed dates: a commit's age is shown, and must not tick over mid-test.
const DATE = "2023-01-01T00:00:00Z";
const GIT_ENV = { ...process.env, GIT_AUTHOR_NAME: "T", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "T", GIT_COMMITTER_EMAIL: "t@t", GIT_AUTHOR_DATE: DATE, GIT_COMMITTER_DATE: DATE, GIT_CONFIG_GLOBAL: "/dev/null" };
const SPACE = "sp1", FIRST_TAB = "tb1", GRAPH_TAB = "tbGraph";

const base = mkdtempSync(join(tmpdir(), "commits-section-test-"));
after(() => rmSync(base, { recursive: true, force: true }));

const git = (cwd, ...args) => execFileSync("git", args, { cwd, env: GIT_ENV, encoding: "utf8" }).trim();
const commitIn = (cwd, subject) => git(cwd, "commit", "-q", "--allow-empty", "-m", subject);
let repos = 0;

function repoOf(...subjects) {
  const repo = join(base, `repo-${++repos}`);
  git(base, "init", "-q", "-b", "main", repo);
  subjects.forEach((subject) => commitIn(repo, subject));
  return repo;
}

function workIn(folder) {
  world.spaces = [{ id: SPACE, active: true, folder, machine: null, tabs: [{ id: FIRST_TAB, active: true }] }];
  world.panes = [{ pane: "p1", terminal: "t1", tab: FIRST_TAB, cwd: folder, focused: true }];
  world.focused = { space: SPACE, tab: FIRST_TAB, pane: "p1", cwd: folder };
}

async function sectionIn(folder) {
  workIn(folder);
  const cx = fakeCx(), part = commits.create({}, cx);
  await cx.settle();
  return { cx, part };
}

const tick = (cx) => cx.timers.find((timer) => timer.repeats).fn(cx);
const clickCommit = (part, cx, hash) => findById(part.render(cx), `commit-${hash}`).handlers.on_click({}, cx);
const head = (repo) => git(repo, "rev-parse", "HEAD");

// What herdr does on tab.new with a mod: a new tab holding that mod's pane.
function applyRuns() {
  for (const { name, args } of world.runs.splice(0)) {
    if (name !== "tab.new") continue;
    const space = world.spaces.find((s) => s.id === args.space);
    space.tabs.push({ id: GRAPH_TAB, active: true });
    world.panes.push({ pane: "pGraph", terminal: null, mod: args.mod, tab: GRAPH_TAB, cwd: null, focused: false });
    world.props = args.props;
  }
}

async function graphAfterSettling() {
  const cx = fakeCx(), view = new GitGraph();
  view.init(world.props, cx);
  for (let i = 0; i < 12; i++) {
    view.render(cx);
    await cx.settle();
  }
  return view;
}

beforeEach(() => resetWorld());

test("it starts collapsed, under the panel's content-sized rule", () => {
  assert.equal(commits.id, "commits");
  assert.equal(commits.label, "Commits");
  assert.equal(commits.defaultOpen, false);
  assert.equal(commits.fill, false);
});

test("it shows the current branch's commits with their lane", async () => {
  // Arrange
  const repo = repoOf("first", "second");

  // Act
  const { cx, part } = await sectionIn(repo);
  const shown = part.render(cx);

  // Assert
  assert.match(textOf(shown), /\* .*second/);
  assert.match(textOf(shown), /\* .*first/);
});

test("the collapsed header shows the newest commit without ever rendering the body", async () => {
  // Arrange
  const repo = repoOf("first", "second");

  // Act
  const { part } = await sectionIn(repo);

  // Assert
  assert.equal(part.summary(), `${git(repo, "rev-parse", "--short", "HEAD")} second`);
});

test("clicking a commit opens the Graph tab with that commit selected", async () => {
  // Arrange
  const repo = repoOf("first", "second"), older = git(repo, "rev-parse", "HEAD~1");
  const { cx, part } = await sectionIn(repo);

  // Act
  clickCommit(part, cx, older);
  assert.equal(world.runs[0].name, "tab.new");
  assert.equal(world.runs[0].args.mod, "git-graph");
  applyRuns();
  const graph = await graphAfterSettling();

  // Assert
  assert.equal(graph.part.selected, older);
});

test("clicking another commit reuses the open tab", async () => {
  // Arrange
  const repo = repoOf("first", "second"), older = git(repo, "rev-parse", "HEAD~1");
  const { cx, part } = await sectionIn(repo);
  clickCommit(part, cx, older);
  applyRuns();

  // Act
  clickCommit(part, cx, head(repo));

  // Assert
  assert.deepEqual(world.runs, [{ name: "tab.select", args: { id: GRAPH_TAB } }]);
});

test("the Graph tab is told the repository listed, not where the terminal has since gone", async () => {
  // Arrange
  const repo = repoOf("first"), root = git(repo, "rev-parse", "--show-toplevel");
  const { cx, part } = await sectionIn(repo);
  world.panes[0].cwd = "/somewhere/else";

  // Act
  clickCommit(part, cx, head(repo));

  // Assert
  assert.equal(world.shared["git-graph.open"][SPACE].folder, root);
});

test("only commit rows respond to clicks, and rows joining lanes aren't among them", async () => {
  // Arrange
  const repo = repoOf("base");
  git(repo, "switch", "-q", "-c", "side");
  commitIn(repo, "on side");
  git(repo, "switch", "-q", "main");
  commitIn(repo, "on main");
  git(repo, "merge", "-q", "--no-ff", "-m", "merge side", "side");
  const { cx, part } = await sectionIn(repo);

  // Act
  const clickable = [];
  walk(part.render(cx), (el) => { if (Object.keys(el.handlers ?? {}).length) clickable.push(el.elementId); });

  // Assert: the four commits, and nothing else
  const hashes = git(repo, "log", "--format=%H").split("\n");
  assert.deepEqual(clickable.sort(), hashes.map((hash) => `commit-${hash}`).sort());
});

test("using the section only reads the repository", async () => {
  // Arrange
  const repo = repoOf("first", "second");
  const before = [git(repo, "show-ref"), git(repo, "status", "--porcelain=v2", "--branch")];
  const { cx, part } = await sectionIn(repo);

  // Act
  tick(cx);
  await cx.settle();
  clickCommit(part, cx, head(repo));

  // Assert
  const subcommands = new Set(world.execs.map(({ args }) => args.find((arg) => !arg.startsWith("-"))));
  assert.deepEqual([...subcommands].sort(), ["log", "rev-parse"]);
  assert.deepEqual([git(repo, "show-ref"), git(repo, "status", "--porcelain=v2", "--branch")], before);
});

test("after a cd it follows the new repository, keeping the old list until the answer", async () => {
  // Arrange
  const one = repoOf("in one"), two = repoOf("in two");
  const { cx, part } = await sectionIn(one);
  const notifiedBefore = cx.notified;

  // Act
  workIn(two);
  part.sync(cx);
  const whileLoading = textOf(part.render(cx));
  await cx.settle();

  // Assert
  assert.match(whileLoading, /in one/);
  assert.match(textOf(part.render(cx)), /in two/);
  assert.equal(cx.notified, notifiedBefore + 1);
});

test("an answer overtaken by a cd is dropped", async () => {
  // Arrange: the first repository's log waits until the second's has answered
  const one = repoOf("in one"), two = repoOf("in two");
  let release;
  const held = new Promise((resolve) => { release = resolve; });
  world.execGate = ({ cwd, args }) => (cwd === one && args.includes("log") ? held : null);
  workIn(one);
  const cx = fakeCx(), part = commits.create({}, cx);
  await new Promise((resolve) => setImmediate(resolve));

  // Act
  workIn(two);
  part.sync(cx);
  await new Promise((resolve) => setImmediate(resolve));
  release();
  await cx.settle();

  // Assert
  assert.match(textOf(part.render(cx)), /in two/);
});

test("a render with nothing new starts no git", async () => {
  // Arrange
  const repo = repoOf("first");
  const { cx, part } = await sectionIn(repo);
  const calls = world.execs.length;

  // Act
  part.sync(cx);
  await cx.settle();

  // Assert
  assert.equal(world.execs.length, calls);
});

test("the timer finds a new commit, and redraws only for that", async () => {
  // Arrange
  const repo = repoOf("first");
  const { cx, part } = await sectionIn(repo);
  const notifiedBefore = cx.notified;

  // Act: nothing new, then a commit
  tick(cx);
  await cx.settle();
  const quietNotifies = cx.notified - notifiedBefore;
  commitIn(repo, "second");
  tick(cx);
  await cx.settle();

  // Assert
  assert.equal(quietNotifies, 0);
  assert.equal(cx.notified, notifiedBefore + 1);
  assert.match(part.summary(), /second$/);
});

test("the timer runs no git while the window isn't active", async () => {
  // Arrange
  const repo = repoOf("first");
  const { cx } = await sectionIn(repo);
  const calls = world.execs.length;
  world.windowActive = false;

  // Act
  tick(cx);
  await cx.settle();

  // Assert
  assert.equal(world.execs.length, calls);
});

test("timer ticks don't pile up behind a slow git", async () => {
  // Arrange
  const repo = repoOf("first");
  const { cx } = await sectionIn(repo);
  let release;
  const held = new Promise((resolve) => { release = resolve; });
  world.execGate = () => held;
  const calls = world.execs.length;

  // Act
  tick(cx);
  await new Promise((resolve) => setImmediate(resolve));
  tick(cx);
  await new Promise((resolve) => setImmediate(resolve));
  const started = world.execs.length - calls;
  release();
  await cx.settle();

  // Assert: the one look's first call, and no second look
  assert.equal(started, 1);
});

test("outside a repository the body says so", async () => {
  // Arrange
  const folder = mkdtempSync(join(base, "plain-"));

  // Act
  const { cx, part } = await sectionIn(folder);

  // Assert
  assert.equal(part.summary(), "Not a git repository");
  assert.match(textOf(part.render(cx)), /Not a git repository/);
});
