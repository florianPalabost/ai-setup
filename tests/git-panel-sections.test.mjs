import assert from "node:assert/strict";
import { test } from "node:test";
import { changesSummary, loadOpen, toggleOpen } from "../herdr/mods/git/sections.js";

const SECTIONS = [
  { id: "changes", defaultOpen: true },
  { id: "pr", defaultOpen: true },
  { id: "prs", defaultOpen: false },
];

test("with nothing remembered, each section starts at its default", () => {
  // Arrange
  const remembered = null;

  // Act
  const open = loadOpen(remembered, SECTIONS);

  // Assert
  assert.deepEqual(open, { changes: true, pr: true, prs: false });
});

test("remembered state wins over the defaults", () => {
  // Arrange
  const remembered = '{"changes":false,"prs":true}';

  // Act
  const open = loadOpen(remembered, SECTIONS);

  // Assert
  assert.deepEqual(open, { changes: false, pr: true, prs: true });
});

test("a section added after the state was saved gets its default, a dropped one is forgotten", () => {
  // Arrange
  const remembered = '{"changes":false,"gone":true}';

  // Act
  const open = loadOpen(remembered, SECTIONS);

  // Assert
  assert.deepEqual(open, { changes: false, pr: true, prs: false });
});

test("unreadable remembered state falls back to the defaults", () => {
  for (const remembered of ["{not json", "null", "[1]", '{"changes":"yes"}']) {
    // Act
    const open = loadOpen(remembered, SECTIONS);

    // Assert
    assert.deepEqual(open, { changes: true, pr: true, prs: false }, remembered);
  }
});

test("opening a section leaves the others as they are, so several can be open", () => {
  // Arrange
  const open = { changes: true, pr: false, prs: false };

  // Act
  const next = toggleOpen(open, "pr");

  // Assert
  assert.deepEqual(next, { changes: true, pr: true, prs: false });
});

test("collapsing a section leaves the others open", () => {
  // Arrange
  const open = { changes: true, pr: true, prs: false };

  // Act
  const next = toggleOpen(open, "changes");

  // Assert
  assert.deepEqual(next, { changes: false, pr: true, prs: false });
});

test("the Changes summary gives the file count and the added and removed lines", () => {
  // Arrange
  const files = [{ add: 10, del: 2 }, { add: 0, del: 5 }, { add: 1, del: 0 }];

  // Act
  const summary = changesSummary(files);

  // Assert
  assert.equal(summary, "3 files  +11 −7");
});

test("the Changes summary uses the singular for one file", () => {
  assert.equal(changesSummary([{ add: 1, del: 1 }]), "1 file  +1 −1");
});

test("the Changes summary says so when nothing changed", () => {
  assert.equal(changesSummary([]), "No changes");
});

test("the Changes summary shows the error instead of a count", () => {
  assert.equal(changesSummary([], "Not a git repository"), "Not a git repository");
});
