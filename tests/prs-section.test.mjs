// The My PRs & reviews section in a fake herdr, with gh's answers faked: when it
// asks GitHub, and whether every open copy shares the one answer.
import assert from "node:assert/strict";
import { beforeEach, mock, test } from "node:test";
import { fakeCx } from "./fakes/mod-view.mjs";
import * as herdr from "./fakes/herdr-module.mjs";

const { world, resetWorld } = herdr;
const { myPrs } = await import("../herdr/mods/git/prs-section.js");

const SECOND = 1000, MINUTE = 60 * SECOND;
const START = 1_000_000_000_000;

function workIn(folder, branch = "main") {
  world.spaces = [{ id: "sp1", active: true, folder, branch, machine: null, tabs: [{ id: "tb1", active: true }] }];
  world.panes = [{ pane: "p1", terminal: "t1", tab: "tb1", cwd: folder, branch }];
  world.focused = { space: "sp1", tab: "tb1", pane: "p1", cwd: folder };
}

const pr = (state) => ({
  number: 1, title: "A PR", url: "https://github.com/o/r/pull/1", isDraft: false, reviewDecision: null, updatedAt: "2023-01-01T00:00:00Z",
  repository: { nameWithOwner: "o/r" }, author: { login: "me" },
  commits: { nodes: [{ commit: { statusCheckRollup: { state } } }] },
});

function githubSays(nodes) {
  const search = { issueCount: nodes.length, nodes };
  world.execAnswer = () => ({ code: 0, stdout: JSON.stringify({ data: { mine: search, review: { issueCount: 0, nodes: [] } } }), stderr: "" });
}

const ghCalls = () => world.execs.filter((call) => call.program === "gh");
const usedCache = (call) => call.args.includes("--cache");

async function openCopy() {
  const cx = fakeCx(), part = myPrs.create({}, cx);
  await cx.settle();
  return { cx, part };
}

// A panel render, as herdr does on any redraw.
async function renderPanel({ cx, part }) {
  part.sync(cx);
  await cx.settle();
}

// Time passing with the panel idle, up to its next timer tick.
async function wait(ms, { cx }) {
  mock.timers.tick(ms);
  cx.timers.find((timer) => timer.repeats).fn(cx);
  await cx.settle();
}

beforeEach(() => {
  mock.timers.reset();
  mock.timers.enable({ apis: ["Date"], now: START });
  resetWorld();
  // What every copy shares lives on globalThis, as it does in herdr.
  delete globalThis.__gitPanelSlots;
  workIn("/repo-a");
  githubSays([pr("SUCCESS")]);
});

test("the first look may use gh's cache", async () => {
  // Act
  await openCopy();

  // Assert
  assert.equal(ghCalls().length, 1);
  assert.equal(usedCache(ghCalls()[0]), true);
});

test("a cd asks GitHub again, skipping gh's cache", async () => {
  // Arrange
  const copy = await openCopy();
  workIn("/repo-b");

  // Act
  await renderPanel(copy);

  // Assert
  assert.equal(ghCalls().length, 2);
  assert.equal(usedCache(ghCalls()[1]), false);
});

test("a branch change asks GitHub again, skipping gh's cache", async () => {
  // Arrange
  const copy = await openCopy();
  workIn("/repo-a", "feat/x");

  // Act
  await renderPanel(copy);

  // Assert
  assert.equal(ghCalls().length, 2);
  assert.equal(usedCache(ghCalls()[1]), false);
});

test("a render in the same place asks nothing", async () => {
  // Arrange
  const copy = await openCopy();

  // Act
  await renderPanel(copy);

  // Assert
  assert.equal(ghCalls().length, 1);
});

test("open copies share one call after a cd, and one result", async () => {
  // Arrange
  const first = await openCopy(), second = await openCopy();
  workIn("/repo-b");
  githubSays([pr("SUCCESS"), pr("FAILURE")]);

  // Act
  await renderPanel(first);
  await renderPanel(second);

  // Assert
  assert.equal(ghCalls().length, 2);
  assert.equal(first.part.summary(), "2");
  assert.equal(second.part.summary(), "2");
});

test("while CI is pending the timer asks each minute", async () => {
  // Arrange
  githubSays([pr("PENDING")]);
  const copy = await openCopy();

  // Act
  await wait(MINUTE, copy);

  // Assert
  assert.equal(ghCalls().length, 2);
  assert.equal(usedCache(ghCalls()[1]), true);
});

test("with nothing pending, a minute isn't enough", async () => {
  // Arrange
  const copy = await openCopy();

  // Act
  await wait(MINUTE, copy);

  // Assert
  assert.equal(ghCalls().length, 1);
});

test("with nothing pending, the timer asks every five minutes", async () => {
  // Arrange
  const copy = await openCopy();

  // Act
  await wait(5 * MINUTE, copy);

  // Assert
  assert.equal(ghCalls().length, 2);
});

test("the timer waits while the window is inactive", async () => {
  // Arrange
  const copy = await openCopy();
  world.windowActive = false;

  // Act
  await wait(10 * MINUTE, copy);

  // Assert
  assert.equal(ghCalls().length, 1);
});
