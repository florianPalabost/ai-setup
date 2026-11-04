// Opening the Graph tab from the Git panel, and what the tab makes of it.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, beforeEach, test } from "node:test";
import { fakeCx, findById, findList, textOf } from "./fakes/mod-view.mjs";
import * as herdr from "./fakes/herdr-module.mjs";

const { world, resetWorld } = herdr;
const { default: GitGraph } = await import("../herdr/mods/git-graph/main.js");
const { openGraphTab } = await import("../herdr/mods/git/graph-tab.js");

const GIT_ENV = { ...process.env, GIT_AUTHOR_NAME: "T", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "T", GIT_COMMITTER_EMAIL: "t@t", GIT_CONFIG_GLOBAL: "/dev/null" };
const SPACE = "sp1", OTHER_SPACE = "sp2", FIRST_TAB = "tb1", GRAPH_TAB = "tbGraph";

const base = mkdtempSync(join(tmpdir(), "graph-tab-test-"));
after(() => rmSync(base, { recursive: true, force: true }));

const git = (cwd, ...args) => execFileSync("git", args, { cwd, env: GIT_ENV, encoding: "utf8" }).trim();
let repos = 0;

// A repo of `count` commits, oldest first, with their hashes.
function repoOf(count) {
  const repo = join(base, `repo-${++repos}`);
  execFileSync("git", ["init", "-q", "-b", "main", repo], { env: GIT_ENV });
  let stream = "";
  for (let i = 1; i <= count; i++) {
    const message = `c${i}`;
    stream += `commit refs/heads/main\nmark :${i}\ncommitter T <t@t> ${1700000000 + i} +0000\ndata ${message.length}\n${message}\n${i > 1 ? `from :${i - 1}\n` : ""}\n`;
  }
  execFileSync("git", ["fast-import", "--quiet"], { cwd: repo, env: GIT_ENV, input: stream });
  git(repo, "reset", "-q", "--hard", "main");
  return { repo, hashes: git(repo, "log", "--reverse", "--format=%H").split("\n") };
}

function windowWithOneTerminal(folder) {
  resetWorld({
    spaces: [{ id: SPACE, active: true, folder, machine: null, tabs: [{ id: FIRST_TAB, active: true }] }],
    panes: [{ pane: "p1", terminal: "t1", tab: FIRST_TAB, cwd: folder, focused: true }],
    focused: { space: SPACE, tab: FIRST_TAB, pane: "p1", cwd: folder },
  });
}

// What herdr does on tab.new with a mod: a new tab holding that mod's pane, shown.
function applyRuns() {
  for (const { name, args } of world.runs.splice(0)) {
    if (name !== "tab.new") continue;
    const space = world.spaces.find((s) => s.id === args.space);
    space.tabs.forEach((tab) => { tab.active = false; });
    space.tabs.push({ id: GRAPH_TAB, active: true });
    world.panes.push({ pane: "pGraph", terminal: null, mod: args.mod, tab: GRAPH_TAB, cwd: null, focused: true });
    world.props = args.props;
  }
}

async function openedGraph() {
  const cx = fakeCx(), view = new GitGraph();
  view.init(world.props, cx);
  await cx.settle();
  return { view, cx, draw: () => view.render(cx) };
}

// Renders until the graph has nothing left to do.
async function settled({ cx, draw }) {
  for (let i = 0; i < 12; i++) {
    draw();
    await cx.settle();
  }
  return draw();
}

beforeEach(() => resetWorld());

test("the first open makes a Graph tab in the shown space", () => {
  // Arrange
  windowWithOneTerminal("/work/repo");

  // Act
  openGraphTab(herdr);

  // Assert
  assert.equal(world.runs.length, 1);
  const [{ name, args }] = world.runs;
  assert.equal(name, "tab.new");
  assert.equal(args.name, "Graph");
  assert.equal(args.mod, "git-graph");
  assert.equal(args.space, SPACE);
});

test("opening again selects the same tab instead of making another", () => {
  // Arrange
  windowWithOneTerminal("/work/repo");
  openGraphTab(herdr);
  applyRuns();

  // Act
  openGraphTab(herdr);

  // Assert
  assert.deepEqual(world.runs, [{ name: "tab.select", args: { id: GRAPH_TAB } }]);
});

test("each space gets its own Graph tab", () => {
  // Arrange
  windowWithOneTerminal("/work/repo");
  openGraphTab(herdr);
  applyRuns();
  world.spaces[0].active = false;
  world.spaces.push({ id: OTHER_SPACE, active: true, folder: "/work/other", machine: null, tabs: [{ id: "tb9", active: true }] });

  // Act
  openGraphTab(herdr);

  // Assert
  assert.equal(world.runs[0].name, "tab.new");
  assert.equal(world.runs[0].args.space, OTHER_SPACE);
});

test("a tab opened with a commit shows that commit selected, on screen", async () => {
  // Arrange
  const { repo, hashes } = repoOf(5);
  windowWithOneTerminal(repo);
  openGraphTab(herdr, { commit: hashes[1] });
  applyRuns();

  // Act
  const graph = await openedGraph();
  const root = await settled(graph);

  // Assert
  assert.equal(graph.view.part.selected, hashes[1]);
  assert.match(textOf(root), new RegExp(hashes[1]), "the details name it");
  assert.deepEqual(findList(root).scroll.scrolledTo.at(-1), { index: 3, strategy: "center" });
});

test("a tab already open moves to a newly asked commit", async () => {
  // Arrange
  const { repo, hashes } = repoOf(5);
  windowWithOneTerminal(repo);
  openGraphTab(herdr, { commit: hashes[1] });
  applyRuns();
  const graph = await openedGraph();
  await settled(graph);

  // Act
  openGraphTab(herdr, { commit: hashes[3] });
  await settled(graph);

  // Assert
  assert.equal(graph.view.part.selected, hashes[3]);
});

test("opening without a commit leaves the selection as it is", async () => {
  // Arrange
  const { repo, hashes } = repoOf(5);
  windowWithOneTerminal(repo);
  openGraphTab(herdr, { commit: hashes[1] });
  applyRuns();
  const graph = await openedGraph();
  await settled(graph);

  // Act
  openGraphTab(herdr);
  await settled(graph);

  // Assert
  assert.equal(graph.view.part.selected, hashes[1]);
});

test("the tab follows the folder it's asked for, and keeps it when asked for none", async () => {
  // Arrange
  const first = repoOf(2), second = repoOf(3);
  windowWithOneTerminal(first.repo);
  openGraphTab(herdr, { folder: first.repo });
  applyRuns();
  const graph = await openedGraph();
  await settled(graph);
  assert.equal(graph.view.part.commits.length, 2);

  // Act
  openGraphTab(herdr, { folder: second.repo, commit: second.hashes[0] });
  await settled(graph);
  const afterMove = graph.view.part.commits.length;
  world.focused = { space: SPACE, tab: GRAPH_TAB, pane: "pGraph", cwd: null };
  openGraphTab(herdr);
  await settled(graph);

  // Assert
  assert.equal(afterMove, 3);
  assert.equal(graph.view.part.selected, second.hashes[0]);
  assert.equal(graph.view.part.commits.length, 3);
});

test("with no folder asked for and none yet, the tab shows the space's folder", async () => {
  // Arrange: "Graph ↗" pressed with no terminal focused
  const { repo } = repoOf(2);
  windowWithOneTerminal(repo);
  world.focused = { space: SPACE, tab: FIRST_TAB, pane: null, cwd: null };
  world.panes = [];
  openGraphTab(herdr);
  applyRuns();

  // Act
  const graph = await openedGraph();
  await settled(graph);

  // Assert
  assert.equal(graph.view.part.commits.length, 2);
});

test("a commit older than the first page is paged to", async () => {
  // Arrange
  const { repo, hashes } = repoOf(700);
  windowWithOneTerminal(repo);
  openGraphTab(herdr, { commit: hashes[0] });
  applyRuns();

  // Act
  const graph = await openedGraph();
  await settled(graph);

  // Assert
  assert.equal(graph.view.part.selected, hashes[0]);
});

test("a commit the view doesn't hold is said so, with the table still there", async () => {
  // Arrange
  const { repo } = repoOf(3);
  const unknown = "1234567890".repeat(4);
  windowWithOneTerminal(repo);
  openGraphTab(herdr, { commit: unknown });
  applyRuns();

  // Act
  const graph = await openedGraph();
  const root = await settled(graph);

  // Assert
  assert.equal(graph.view.part.selected, null);
  assert.match(textOf(findById(root, "graph-notice")), /12345678 isn't in this view/);
  assert.ok(findList(root), "the table still draws");
});

test("something that isn't a full hash is refused with a message", async () => {
  // Arrange
  const { repo } = repoOf(3);
  windowWithOneTerminal(repo);
  openGraphTab(herdr, { commit: "--all" });
  applyRuns();

  // Act
  const graph = await openedGraph();
  const root = await settled(graph);

  // Assert
  assert.match(textOf(findById(root, "graph-notice")), /--all isn't a full commit hash/);
  assert.ok(!world.execs.some(({ args }) => args.includes("show")), "it never reached git");
});

test("a request for another space leaves this tab alone", async () => {
  // Arrange
  const { repo, hashes } = repoOf(3);
  windowWithOneTerminal(repo);
  openGraphTab(herdr);
  applyRuns();
  const graph = await openedGraph();
  await settled(graph);
  world.spaces[0].active = false;
  world.spaces.push({ id: OTHER_SPACE, active: true, folder: repo, machine: null, tabs: [{ id: "tb9", active: true }] });

  // Act
  openGraphTab(herdr, { commit: hashes[0] });
  await settled(graph);

  // Assert
  assert.equal(graph.view.part.selected, null);
});

test("requests for spaces that are gone don't pile up", () => {
  // Arrange
  windowWithOneTerminal("/work/repo");
  world.shared["git-graph.open"] = { spGone: { seq: 4, folder: "/old", commit: null } };

  // Act
  openGraphTab(herdr);

  // Assert
  assert.deepEqual(Object.keys(world.shared["git-graph.open"]), [SPACE]);
});

test("a commit asked twice in a row is taken twice", async () => {
  // Arrange: unselected by hand between the two asks
  const { repo, hashes } = repoOf(3);
  windowWithOneTerminal(repo);
  openGraphTab(herdr, { commit: hashes[0] });
  applyRuns();
  const graph = await openedGraph();
  await settled(graph);
  graph.view.part.selected = null;

  // Act
  openGraphTab(herdr, { commit: hashes[0] });
  await settled(graph);

  // Assert
  assert.equal(graph.view.part.selected, hashes[0]);
});
