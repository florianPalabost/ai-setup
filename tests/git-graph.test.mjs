// The git-graph fork, run outside herdr against real throwaway repositories.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, beforeEach, test } from "node:test";
import { fakeCx, findById, findList, findPressTarget, textOf } from "./fakes/mod-view.mjs";
import { resetWorld, world } from "./fakes/herdr-module.mjs";

const { default: GitGraph } = await import("../herdr/mods/git-graph/main.js");
const { Menu } = await import("../herdr/mods/git-graph/menu.js");

const FORK = new URL("../herdr/mods/git-graph/", import.meta.url);
const READ_ONLY_GIT = new Set(["rev-parse", "log", "symbolic-ref", "for-each-ref", "remote", "status", "show", "diff", "diff-tree"]);
const GIT_ENV = { ...process.env, GIT_AUTHOR_NAME: "T", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "T", GIT_COMMITTER_EMAIL: "t@t", GIT_CONFIG_GLOBAL: "/dev/null" };

const base = mkdtempSync(join(tmpdir(), "git-graph-test-"));
after(() => rmSync(base, { recursive: true, force: true }));
beforeEach(() => resetWorld());

const git = (cwd, ...args) => execFileSync("git", args, { cwd, env: GIT_ENV, encoding: "utf8" }).trim();
let repos = 0;

function commit(repo, name) {
  writeFileSync(join(repo, `${name}.txt`), name);
  git(repo, "add", ".");
  git(repo, "commit", "-qm", name);
  return git(repo, "rev-parse", "HEAD");
}

// main: init - two - merge of `side`, which holds s1. Returns the repo and its hashes.
function repoWithMerge() {
  const repo = join(base, `repo-${++repos}`);
  execFileSync("git", ["init", "-q", "-b", "main", repo], { env: GIT_ENV });
  const init = commit(repo, "init");
  git(repo, "checkout", "-qb", "side");
  const s1 = commit(repo, "s1");
  git(repo, "checkout", "-q", "main");
  const two = commit(repo, "two");
  git(repo, "merge", "-q", "--no-ff", "side", "-m", "merge side");
  return { repo, init, s1, two, merge: git(repo, "rev-parse", "HEAD") };
}

async function openGraph(folder, change = {}) {
  resetWorld({ props: { folder }, spaces: [{ id: "s1", active: true, folder, machine: null, tabs: [{ id: "t1", active: true }] }],
    panes: [{ pane: "p1", mod: "git-graph", tab: "t1", cwd: null, focused: true }], focused: { space: "s1", tab: "t1", pane: "p1", cwd: null }, ...change });
  const cx = fakeCx(), view = new GitGraph();
  view.init(world.props, cx);
  await cx.settle();
  return { view, cx, draw: () => view.render(cx) };
}

const gitWrites = () => world.execs.filter(({ program, args }) => {
  const words = args.filter((arg, i) => !arg.startsWith("-") && args[i - 1] !== "-c");
  return program !== "git" || !READ_ONLY_GIT.has(words[0]);
});

test("the graph only reads: a double-click on a branch label checks nothing out", async () => {
  // Arrange
  const { repo, s1 } = repoWithMerge();
  const { view, cx, draw } = await openGraph(repo);
  const root = draw();
  const labelX = view.part.graphWidth() + 6 + 2;

  // Act: `side` isn't checked out, so upstream would switch to it here
  findPressTarget(root).handlers.on_mouse_down({ click_count: 2, local_position: { x: labelX } }, cx);
  findList(root).handlers.on_item_click(s1, cx);
  await cx.settle();

  // Assert
  assert.equal(git(repo, "symbolic-ref", "--short", "HEAD"), "main");
  assert.deepEqual(gitWrites(), []);
  assert.deepEqual(world.overlays, []);
});

test("the header offers no Fetch, even with a remote", async () => {
  // Arrange
  const { repo } = repoWithMerge();
  git(repo, "remote", "add", "origin", join(base, "nowhere.git"));

  // Act
  const { draw } = await openGraph(repo);

  // Assert
  const root = draw();
  assert.equal(findById(root, "graph-fetch"), null);
  assert.ok(findById(root, "graph-refresh"), "refresh is still there");
});

for (const target of [
  { kind: "commit" }, { kind: "branch", name: "side" }, { kind: "remote", name: "origin/side" }, { kind: "tag", name: "v1" }, { kind: "uncommitted" },
]) {
  test(`the right-click menu on a ${target.kind} holds nothing that writes`, () => {
    // Arrange
    const hash = "a".repeat(40);
    const ctx = { root: "/r", on: null, current: "main", head: "b".repeat(40), branches: ["main", "side"], remotes: ["origin"] };
    resetWorld({ props: { target: { ...target, commit: { hash, subject: "s", parents: [] } }, ctx } });
    const menu = new Menu();

    // Act
    menu.init(fakeCx());

    // Assert
    const types = menu.items.filter((item) => !item.separator).map((item) => item.action.type);
    assert.ok(types.length > 0, "the menu isn't empty");
    assert.deepEqual(types.filter((type) => type !== "copy" && type !== "showChanges"), []);
  });
}

test("there is no update check: nothing in the fork reaches for the network", () => {
  // Arrange
  const sources = readdirSync(FORK).filter((file) => file.endsWith(".js"));

  // Act
  const offenders = sources.filter((file) => /\bfetch\(|api\.github\.com|releases\/latest/.test(readFileSync(new URL(file, FORK), "utf8")));

  // Assert
  assert.deepEqual(offenders, []);
  assert.ok(sources.includes("graph.js"), "the fork's sources were read");
});

test("opening the graph asks the network for nothing", async () => {
  // Arrange
  const { repo } = repoWithMerge();
  const real = globalThis.fetch;
  const asked = [];
  globalThis.fetch = async (url) => { asked.push(url); throw new Error("no network in tests"); };

  // Act
  const { cx, draw } = await openGraph(repo);
  draw();
  for (const timer of cx.timers.filter((t) => t.repeats)) timer.fn(cx);
  await cx.settle();
  globalThis.fetch = real;

  // Assert
  assert.deepEqual(asked, []);
  assert.deepEqual(world.shared["git-graph.update"], undefined);
});

test("the repository's history shows in the table", async () => {
  // Arrange
  const { repo, merge } = repoWithMerge();

  // Act
  const { cx, draw } = await openGraph(repo);

  // Assert
  const rows = findList(draw()).list.render({ start: 0, end: 4 }, cx);
  assert.equal(findList(draw()).list.count, 4);
  assert.equal(rows[0].elementId, `c-${merge}`);
  assert.match(textOf(rows[0]), /merge side/);
});
