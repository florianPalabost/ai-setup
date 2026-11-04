import assert from "node:assert/strict";
import { test } from "node:test";
import { createOpener } from "../herdr/mods/git/opener.js";

const URL = "https://github.com/o/r/pull/1?a=1&b=2";
const WSL_VERSION = "Linux version 6.6.87.2-microsoft-standard-WSL2 (root@machine)";
const LINUX_VERSION = "Linux version 6.8.0-45-generic (buildd@lcy02)";

function world({ platform, procVersion = null, result = { code: 0, stdout: "", stderr: "" } }) {
  const calls = [], warnings = [];
  const open = createOpener({
    platform: () => platform,
    readTextFile: async () => procVersion,
    exec: async (command, args) => {
      calls.push([command, ...args]);
      if (result instanceof Error) throw result;
      return result;
    },
    warn: (message) => warnings.push(message),
  });
  return { open, calls, warnings };
}

test("native Windows hands the URL straight to explorer.exe, with no shell", async () => {
  // Arrange
  const { open, calls } = world({ platform: "windows" });

  // Act
  await open(URL);

  // Assert
  assert.deepEqual(calls, [["explorer.exe", URL]]);
});

test("WSL uses explorer.exe, so the Windows browser opens", async () => {
  // Arrange
  const { open, calls } = world({ platform: "linux", procVersion: WSL_VERSION });

  // Act
  await open(URL);

  // Assert
  assert.deepEqual(calls, [["explorer.exe", URL]]);
});

test("explorer.exe exiting 1 is not reported: it does that on success", async () => {
  // Arrange
  const { open, warnings } = world({ platform: "windows", result: { code: 1, stdout: "", stderr: "" } });

  // Act
  await open(URL);

  // Assert
  assert.deepEqual(warnings, []);
});

test("macOS uses open", async () => {
  // Arrange
  const { open, calls } = world({ platform: "macos" });

  // Act
  await open(URL);

  // Assert
  assert.deepEqual(calls, [["open", URL]]);
});

test("plain Linux detaches xdg-open and passes the URL as an argument, never in the script", async () => {
  // Arrange
  const { open, calls } = world({ platform: "linux", procVersion: LINUX_VERSION });

  // Act
  await open(URL);

  // Assert
  const [[command, flag, script, name, url]] = calls;
  assert.equal(command, "sh");
  assert.equal(flag, "-c");
  assert.match(script, /setsid xdg-open "\$1" >\/dev\/null 2>&1 &/);
  assert.ok(!script.includes(URL));
  assert.equal(name, "open-url");
  assert.equal(url, URL);
});

test("Linux with an unreadable /proc/version counts as plain Linux", async () => {
  // Arrange
  const { open, calls } = world({ platform: "linux", procVersion: null });

  // Act
  await open(URL);

  // Assert
  assert.equal(calls[0][0], "sh");
});

test("only http and https links open: a check's target URL is whatever its reporter sent", async () => {
  for (const bad of ["file:///etc/passwd", "C:\\Windows\\system32\\calc.exe", "javascript:alert(1)", "-x", "", null]) {
    // Arrange
    const { open, calls, warnings } = world({ platform: "windows" });

    // Act
    await open(bad);

    // Assert
    assert.deepEqual(calls, [], String(bad));
    assert.equal(warnings.length, bad ? 1 : 0, String(bad));
  }
});

test("a command that can't start warns instead of failing the click", async () => {
  // Arrange
  const { open, warnings } = world({ platform: "macos", result: new Error("not found") });

  // Act
  await open(URL);

  // Assert
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /github\.com\/o\/r\/pull\/1/);
});

test("macOS reporting a failure warns: only explorer.exe's exit code means nothing", async () => {
  // Arrange
  const { open, warnings } = world({ platform: "macos", result: { code: 1, stdout: "", stderr: "no handler" } });

  // Act
  await open(URL);

  // Assert
  assert.equal(warnings.length, 1);
});
