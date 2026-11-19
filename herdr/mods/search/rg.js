import { parseMatches } from "./matches.js";

export const SEARCH_ERROR_CODES = Object.freeze({
  rgMissing: "search_rg_missing",
  rgFailed: "search_rg_failed",
});

export const MATCH_LIMIT = 2000;
const RG_TIMEOUT_MS = 10000;
const PER_FILE = 200;
const MAX_FILESIZE = "1M";
// rg exits 1 when nothing matched; on an error it exits 2, even with matches found.
const RG_NOTHING_FOUND = 1;

const searchError = (code, message) => Object.assign(new Error(message), { code });

export function rgArgs(query, { regex, wholeWord }) {
  return [
    "--json", "--smart-case", "--hidden", "--glob", "!.git/",
    "--max-count", String(PER_FILE), "--max-filesize", MAX_FILESIZE,
    ...(regex ? [] : ["--fixed-strings"]),
    ...(wholeWord ? ["--word-regexp"] : []),
    "--regexp", query,
    // Without a path rg searches stdin when it is not a terminal, and hangs.
    "--", ".",
  ];
}

export async function search(exec, root, query, options) {
  let result;
  try {
    result = await exec("rg", rgArgs(query, options), { cwd: root, timeout: RG_TIMEOUT_MS });
  } catch (error) {
    throw searchError(SEARCH_ERROR_CODES.rgMissing, `No rg on PATH: ${error?.message ?? error}`);
  }
  if (result.code === RG_NOTHING_FOUND) return { files: [], count: 0, capped: false };
  const found = parseMatches(result.stdout, options.limit ?? MATCH_LIMIT);
  if (result.code !== 0 && !found.count) {
    const reason = result.stderr.trim().replace(/\s+/g, " ") || `rg exited ${result.code}`;
    throw searchError(SEARCH_ERROR_CODES.rgFailed, reason);
  }
  return found;
}
