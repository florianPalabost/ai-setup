// A copy of viewer/text.js: herdr loads no module from outside a mod's folder.
// Pure helpers over a file's text: lines as UTF-16 offsets, which is what
// EditorState ranges count in.
export const MAX_CHARS = 400000;
const TRUNCATED = "\n… (file truncated)";
const LANG = { ts: "js", tsx: "js", mts: "js", cts: "js", jsx: "js", mjs: "js", cjs: "js", toml: "yaml", jsonc: "json", svelte: "html", vue: "html" };

export function languageFor(path) {
  const name = path.split("/").pop();
  const ext = name.includes(".") ? name.split(".").pop().toLowerCase() : "txt";
  return LANG[ext] ?? ext;
}

export const isBinary = (text) => text.includes("\0");

export const shown = (text) => (text.length > MAX_CHARS ? text.slice(0, MAX_CHARS) + TRUNCATED : text);

export function lineStart(text, line) {
  let offset = 0;
  for (let current = 1; current < line; current++) {
    const next = text.indexOf("\n", offset);
    if (next < 0) return offset;
    offset = next + 1;
  }
  return offset;
}

export function lineAt(text, offset) {
  let line = 1;
  for (let index = text.indexOf("\n"); index >= 0 && index < offset; index = text.indexOf("\n", index + 1)) line++;
  return line;
}

export function rangeFor(text, { line = 1, column = 0, length = 0 }) {
  const start = lineStart(text, line);
  const end = text.indexOf("\n", start);
  const lineEnd = end < 0 ? text.length : end;
  const from = Math.min(start + column, lineEnd);
  return { start: from, end: Math.min(from + length, lineEnd) };
}
