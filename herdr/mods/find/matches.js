// A copy of search/matches.js: herdr loads no module from outside a mod's folder.
const MATCH_EVENT = "match";

// rg counts columns in UTF-8 bytes.
export function utf16Offset(text, bytes) {
  let used = 0;
  let offset = 0;
  for (const char of text) {
    if (used >= bytes) break;
    const point = char.codePointAt(0);
    used += point < 0x80 ? 1 : point < 0x800 ? 2 : point < 0x10000 ? 3 : 4;
    offset += char.length;
  }
  return offset;
}

function parseEvent(line) {
  try {
    return JSON.parse(line);
  } catch {
    return null;
  }
}

// rg sends raw bytes instead of text for a line that is not valid UTF-8.
function matchesOf(data) {
  const text = data.lines?.text;
  const first = data.submatches[0];
  if (typeof text !== "string" || !first) return [];
  const line = text.replace(/\r?\n$/, "");
  const column = utf16Offset(line, first.start);
  return [{ line: data.line_number, column, length: utf16Offset(line, first.end) - column, text: line }];
}

export function parseMatches(stdout, limit) {
  const byPath = new Map();
  let count = 0;
  let capped = false;
  for (const raw of stdout.split("\n")) {
    const event = raw ? parseEvent(raw) : null;
    if (event?.type !== MATCH_EVENT) continue;
    const path = event.data.path?.text;
    if (typeof path !== "string") continue;
    const found = matchesOf(event.data);
    if (count + found.length > limit) { capped = true; break; }
    if (!byPath.has(path)) byPath.set(path, []);
    byPath.get(path).push(...found);
    count += found.length;
  }
  const files = [...byPath].map(([path, matches]) => ({ path: path.replace(/^\.\//, ""), matches }));
  return { files, count, capped };
}
