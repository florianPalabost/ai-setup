// A copy of quick-open/files.js: herdr loads no module from outside a mod's folder.
// Every file under a root, as `rg --files` sees it: .gitignore respected,
// untracked and hidden files in, .git out. Takes herdr's exec.
export const FILES_ERROR_CODES = Object.freeze({
  rgMissing: "quick_open_rg_missing",
  rgFailed: "quick_open_rg_failed",
});

const RG_TIMEOUT_MS = 20000;
// rg exits 1 when it finds no file at all.
const RG_NOTHING_FOUND = 1;

const filesError = (code, message) => Object.assign(new Error(message), { code });

export async function listFiles(exec, root) {
  let result;
  try {
    result = await exec("rg", ["--files", "--hidden", "--glob", "!.git/"], { cwd: root, timeout: RG_TIMEOUT_MS });
  } catch (error) {
    throw filesError(FILES_ERROR_CODES.rgMissing, `No rg on PATH: ${error?.message ?? error}`);
  }
  if (result.code === RG_NOTHING_FOUND) return [];
  if (result.code !== 0) throw filesError(FILES_ERROR_CODES.rgFailed, result.stderr.trim() || `rg exited ${result.code}`);
  return result.stdout.split("\n").filter(Boolean);
}
