// A copy of viewer/vscode.js: herdr loads no module from outside a mod's folder.
// Opens a file at a line in VS Code. Takes herdr's exec and notify.
export const VSCODE_ERROR_CODES = Object.freeze({
  missing: "vscode_missing",
  failed: "vscode_failed",
});

const VSCODE = "code";

export async function openInVsCode({ exec, notify }, file, line) {
  const fail = (code, body) => notify({ title: "Not opened in VS Code", body: `${body} (${code})`, level: "warning" });
  try {
    const result = await exec(VSCODE, ["-g", `${file}:${line}`]);
    if (result.code !== 0) fail(VSCODE_ERROR_CODES.failed, result.stderr.trim() || `code exited ${result.code}`);
  } catch (error) {
    fail(VSCODE_ERROR_CODES.missing, `No \`code\` on PATH: ${error?.message ?? error}`);
  }
}
