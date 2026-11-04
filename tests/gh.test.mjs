import assert from "node:assert/strict";
import { test } from "node:test";
import { GH_PROBLEM, ghFix, ghGraphql } from "../herdr/mods/git/gh.js";

const QUERY = "query Q { viewer { login } }";

function fakeExec(result) {
  const calls = [];
  const exec = async (command, args, options) => {
    calls.push({ command, args, options });
    if (result instanceof Error) throw result;
    return result;
  };
  return { exec, calls };
}

test("a query goes through gh api graphql, with its variables as raw strings", async () => {
  // Arrange
  const { exec, calls } = fakeExec({ code: 0, stdout: '{"data":{"viewer":{"login":"me"}}}', stderr: "" });

  // Act
  const result = await ghGraphql(exec, { query: QUERY, vars: { branch: "123" }, cwd: "/repo" });

  // Assert
  assert.deepEqual(result, { ok: true, data: { viewer: { login: "me" } } });
  assert.deepEqual(calls, [{
    command: "gh",
    args: ["api", "graphql", "-f", "branch=123", "-f", `query=${QUERY}`],
    options: { cwd: "/repo" },
  }]);
});

test("asking for the cache adds gh's --cache", async () => {
  // Arrange
  const { exec, calls } = fakeExec({ code: 0, stdout: '{"data":{}}', stderr: "" });

  // Act
  await ghGraphql(exec, { query: QUERY, cache: "30s" });

  // Assert
  assert.deepEqual(calls[0].args, ["api", "graphql", "--cache", "30s", "-f", `query=${QUERY}`]);
});

test("gh that can't start counts as missing", async () => {
  // Arrange
  const { exec } = fakeExec(new Error("No such file or directory"));

  // Act
  const result = await ghGraphql(exec, { query: QUERY });

  // Assert
  assert.equal(result.ok, false);
  assert.equal(result.problem, GH_PROBLEM.MISSING);
});

test("gh's auth exit code counts as signed out", async () => {
  // Arrange
  const { exec } = fakeExec({ code: 4, stdout: "", stderr: "To get started with GitHub CLI, please run:  gh auth login" });

  // Act
  const result = await ghGraphql(exec, { query: QUERY });

  // Assert
  assert.equal(result.problem, GH_PROBLEM.SIGNED_OUT);
});

test("a token GitHub refuses counts as signed out", async () => {
  // Arrange
  const stderr = "gh: Bad credentials (HTTP 401)\nTry authenticating with:  gh auth login\n";
  const { exec } = fakeExec({ code: 1, stdout: "", stderr });

  // Act
  const result = await ghGraphql(exec, { query: QUERY });

  // Assert
  assert.equal(result.problem, GH_PROBLEM.SIGNED_OUT);
});

test("any other failure keeps gh's first line", async () => {
  // Arrange
  const { exec } = fakeExec({ code: 1, stdout: "", stderr: "gh: Could not resolve to a Repository\nmore\n" });

  // Act
  const result = await ghGraphql(exec, { query: QUERY });

  // Assert
  assert.equal(result.problem, GH_PROBLEM.FAILED);
  assert.equal(result.message, "gh: Could not resolve to a Repository");
});

test("output that isn't JSON is a failure, not a crash", async () => {
  // Arrange
  const { exec } = fakeExec({ code: 0, stdout: "<html>", stderr: "" });

  // Act
  const result = await ghGraphql(exec, { query: QUERY });

  // Assert
  assert.equal(result.problem, GH_PROBLEM.FAILED);
});

test("the fix text tells the person what to do", () => {
  assert.match(ghFix({ problem: GH_PROBLEM.MISSING }), /cli\.github\.com/);
  assert.match(ghFix({ problem: GH_PROBLEM.SIGNED_OUT }), /gh auth login/);
  assert.equal(ghFix({ problem: GH_PROBLEM.FAILED, message: "boom" }), "gh failed: boom");
});
