
export const TAIL_BYTES = 256 * 1024;
const TAB = "    ";
// CSI sequences (colors, cursor moves), OSC sequences (titles, links) and the two-byte escapes.
const ANSI = /\x1b\[[0-?]*[ -/]*[@-~]|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)|\x1b[@-Z\\-_]/g;

export const stripAnsi = (text) => text.replace(ANSI, "");

export function tailLines(text, cut) {
  const lines = stripAnsi(text).replaceAll("\r", "").replaceAll("\t", TAB).split("\n");
  if (cut) lines.shift();
  if (lines.at(-1) === "") lines.pop();
  return lines;
}

export function matching(lines, filter) {
  const needle = filter.trim().toLowerCase();
  return needle ? lines.filter((line) => line.toLowerCase().includes(needle)) : lines;
}

// An absolute path with its "." and ".." steps resolved, so it matches the paths a folder watch reports.
export function normalizePath(path) {
  const parts = [];
  for (const part of path.split("/")) {
    if (part === "" || part === ".") continue;
    if (part === "..") parts.pop();
    else parts.push(part);
  }
  return `/${parts.join("/")}`;
}
