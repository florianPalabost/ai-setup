import assert from "node:assert/strict";
import { test } from "node:test";
import { locate } from "../herdr/mods/git/location.js";

test("the focused terminal's folder and branch are where the panel looks", () => {
  // Arrange
  const live = {
    spaces: [{ id: "s", active: true, folder: "/space", branch: "space-b", machine: null }],
    focused: { tab: "t", pane: "p2", terminal: "t2", cwd: "/two" },
    panes: [
      { pane: "p1", tab: "t", terminal: "t1", cwd: "/one", branch: "one-b" },
      { pane: "p2", tab: "t", terminal: "t2", cwd: "/two", branch: "two-b" },
    ],
  };

  // Act
  const at = locate(live);

  // Assert
  assert.deepEqual(at, { cwd: "/two", on: null, branch: "two-b" });
});

test("with a mod pane focused, the panel keeps to the tab's first terminal", () => {
  // Arrange
  const live = {
    spaces: [{ id: "s", active: true, folder: "/space", branch: "space-b", machine: null }],
    focused: { tab: "t", pane: "m", terminal: null, cwd: null },
    panes: [
      { pane: "m", tab: "t", terminal: null, mod: "x", cwd: null, branch: null },
      { pane: "p1", tab: "t", terminal: "t1", cwd: "/one", branch: "one-b" },
    ],
  };

  // Act
  const at = locate(live);

  // Assert
  assert.deepEqual(at, { cwd: "/one", on: null, branch: "one-b" });
});

test("a focused layout terminal block on another machine is read as remote", () => {
  // Arrange
  const live = {
    spaces: [{ id: "s", active: true, folder: "/space", branch: null, machine: null }],
    focused: { tab: "t", pane: null, terminal: "vps/t7", cwd: "/srv" },
    panes: [],
  };

  // Act
  const at = locate(live);

  // Assert
  assert.deepEqual(at, { cwd: "/srv", on: "vps", branch: null });
});

test("no terminals fall back to the space's folder", () => {
  // Arrange
  const live = {
    spaces: [{ id: "s", active: true, folder: "/space", branch: "b", machine: null }],
    focused: null,
    panes: [],
  };

  // Act
  const at = locate(live);

  // Assert
  assert.deepEqual(at, { cwd: "/space", on: null, branch: "b" });
});
