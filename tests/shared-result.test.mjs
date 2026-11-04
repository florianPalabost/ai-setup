import assert from "node:assert/strict";
import { test } from "node:test";
import { LOAD_VIEW, SlotWatcher, refreshDue, sharedSlot, startRefresh } from "../herdr/mods/git/shared-result.js";

const MINUTE = 60000;

function deferred() {
  let resolve;
  const promise = new Promise((r) => { resolve = r; });
  return { promise, resolve };
}

test("copies of the mod asking for one slot get the same one, kept outside their own modules", () => {
  // Arrange
  const realm = {};

  // Act
  const first = sharedSlot("pr", realm);
  const second = sharedSlot("pr", realm);
  const other = sharedSlot("prs", realm);

  // Assert
  assert.equal(first, second);
  assert.notEqual(first, other);
});

test("two copies refreshing the same view make one call and see one result", async () => {
  // Arrange
  const slot = sharedSlot("pr", {});
  const call = deferred();
  let calls = 0;
  const load = () => { calls++; return call.promise; };

  // Act
  const first = startRefresh(slot, "view", load);
  const second = startRefresh(slot, "view", load);
  call.resolve({ kind: "pr", n: 1 });
  await Promise.all([first, second]);

  // Assert
  assert.equal(calls, 1);
  assert.deepEqual(slot.value, { kind: "pr", n: 1 });
});

test("the last data stays while the next view loads", async () => {
  // Arrange
  const slot = sharedSlot("pr", {});
  await startRefresh(slot, "repo-a", async () => ({ kind: "pr", n: 1 }));
  const call = deferred();

  // Act
  const pending = startRefresh(slot, "repo-b", () => call.promise);
  const during = slot.value;
  call.resolve({ kind: "pr", n: 2 });
  await pending;

  // Assert
  assert.deepEqual(during, { kind: "pr", n: 1 });
  assert.deepEqual(slot.value, { kind: "pr", n: 2 });
});

test("a slow answer for a view already left is dropped", async () => {
  // Arrange
  const slot = sharedSlot("pr", {});
  const slow = deferred();
  const oldView = startRefresh(slot, "repo-a", () => slow.promise);

  // Act
  await startRefresh(slot, "repo-b", async () => ({ kind: "pr", n: 2 }));
  slow.resolve({ kind: "pr", n: 1 });
  await oldView;

  // Assert
  assert.deepEqual(slot.value, { kind: "pr", n: 2 });
  assert.equal(slot.pending, null);
});

test("a load that throws becomes an error result", async () => {
  // Arrange
  const slot = sharedSlot("pr", {});

  // Act
  await startRefresh(slot, "view", async () => { throw new Error("no such folder"); });

  // Assert
  assert.deepEqual(slot.value, { kind: LOAD_VIEW.ERROR, message: "no such folder" });
});

test("the version moves only when the result changed, so a same answer causes no redraw", async () => {
  // Arrange
  const slot = sharedSlot("pr", {});
  await startRefresh(slot, "view", async () => ({ kind: "pr", n: 1 }));
  const before = slot.version;

  // Act
  await startRefresh(slot, "view", async () => ({ kind: "pr", n: 1 }));
  const same = slot.version;
  await startRefresh(slot, "view", async () => ({ kind: "pr", n: 2 }));

  // Assert
  assert.equal(same, before);
  assert.equal(slot.version, before + 1);
});

test("the first view may use gh's cache", () => {
  // Arrange
  const slot = sharedSlot("pr", {});

  // Act
  const due = refreshDue(slot, "view", { active: true, now: 0, interval: 5 * MINUTE });

  // Assert
  assert.deepEqual(due, { cache: true });
});

test("a cd or branch change refreshes at once, skipping gh's cache, even with the window inactive", async () => {
  // Arrange
  const slot = sharedSlot("pr", {});
  await startRefresh(slot, "repo-a", async () => ({}), () => 1000);

  // Act
  const due = refreshDue(slot, "repo-b", { active: false, now: 1001, interval: 5 * MINUTE });

  // Assert
  assert.deepEqual(due, { cache: false });
});

test("nothing is due before the interval is up", async () => {
  // Arrange
  const slot = sharedSlot("pr", {});
  await startRefresh(slot, "view", async () => ({}), () => 1000);

  // Act
  const due = refreshDue(slot, "view", { active: true, now: 1000 + 5 * MINUTE - 1, interval: 5 * MINUTE });

  // Assert
  assert.equal(due, null);
});

test("the timer refresh uses gh's cache once the interval is up", async () => {
  // Arrange
  const slot = sharedSlot("pr", {});
  await startRefresh(slot, "view", async () => ({}), () => 1000);

  // Act
  const due = refreshDue(slot, "view", { active: true, now: 1000 + MINUTE, interval: MINUTE });

  // Assert
  assert.deepEqual(due, { cache: true });
});

test("the timer waits while the window is inactive", async () => {
  // Arrange
  const slot = sharedSlot("pr", {});
  await startRefresh(slot, "view", async () => ({}), () => 1000);

  // Act
  const due = refreshDue(slot, "view", { active: false, now: 1000 + 10 * MINUTE, interval: MINUTE });

  // Assert
  assert.equal(due, null);
});

test("a refresh that never answered stops blocking once exec's limit has passed", () => {
  // Arrange
  const slot = sharedSlot("pr", {});
  startRefresh(slot, "view", () => new Promise(() => {}), () => 1000);

  // Act
  const due = refreshDue(slot, "view", { active: true, now: 1000 + 2 * MINUTE, interval: MINUTE });

  // Assert
  assert.deepEqual(due, { cache: true });
});

test("a refresh that never answered doesn't catch a new one in its promise", async () => {
  // Arrange
  const slot = sharedSlot("pr", {});
  startRefresh(slot, "view", () => new Promise(() => {}), () => 1000);

  // Act
  await startRefresh(slot, "view", async () => ({ n: 1 }), () => 1000 + 2 * MINUTE);

  // Assert
  assert.deepEqual(slot.value, { n: 1 });
});

test("nothing is due while a refresh of this view is running", () => {
  // Arrange
  const slot = sharedSlot("pr", {});
  startRefresh(slot, "view", () => new Promise(() => {}));

  // Act
  const due = refreshDue(slot, "view", { active: true, now: 10 * MINUTE, interval: MINUTE });

  // Assert
  assert.equal(due, null);
});

// A cx that runs what's spawned and counts redraws.
function watchingCx() {
  const tasks = [];
  const cx = { notified: 0, notify() { cx.notified++; }, spawn(fn) { tasks.push(fn(cx)); }, settle: () => Promise.all(tasks) };
  return cx;
}

test("a copy redraws for a new answer another copy asked for", async () => {
  // Arrange
  const slot = sharedSlot("pr", {}), watcher = new SlotWatcher(slot), cx = watchingCx();

  // Act
  startRefresh(slot, "view", async () => ({ n: 1 }));
  watcher.watch(cx);
  await cx.settle();

  // Assert
  assert.equal(cx.notified, 1);
});

test("a copy doesn't redraw for an answer already on screen", async () => {
  // Arrange
  const slot = sharedSlot("pr", {}), watcher = new SlotWatcher(slot), cx = watchingCx();
  await startRefresh(slot, "view", async () => ({ n: 1 }));
  watcher.markSeen();

  // Act
  startRefresh(slot, "view", async () => ({ n: 1 }));
  watcher.watch(cx);
  await cx.settle();

  // Assert
  assert.equal(cx.notified, 0);
});

test("watching one refresh many times waits on it once", async () => {
  // Arrange
  const slot = sharedSlot("pr", {}), watcher = new SlotWatcher(slot), cx = watchingCx();
  startRefresh(slot, "view", async () => ({ n: 1 }));

  // Act
  watcher.watch(cx);
  watcher.watch(cx);
  await cx.settle();

  // Assert
  assert.equal(cx.notified, 1);
});
