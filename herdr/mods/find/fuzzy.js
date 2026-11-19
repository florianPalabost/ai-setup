// A copy of quick-open/fuzzy.js: herdr loads no module from outside a mod's folder.
// VS Code-style fuzzy matching of a query against file paths: the query's
// characters in order, scored higher at word starts, in the file name and in
// runs. Pure, so node can test it.
const BOUNDARY = 8;
const SEPARATOR = 6;
const CAMEL = 6;
const IN_NAME = 4;
const RUN = 5;
const BASE = 1;
const LENGTH_PENALTY = 0.01;
const NAME_LENGTH_PENALTY = 0.15;
const NONE = -Infinity;
const SEPARATORS = new Set(["_", "-", ".", " "]);

function bonus(path, index, nameStart) {
  let score = BASE + (index >= nameStart ? IN_NAME : 0);
  if (index === 0 || path[index - 1] === "/") return score + BOUNDARY;
  const before = path[index - 1];
  if (SEPARATORS.has(before)) return score + SEPARATOR;
  const char = path[index];
  if (char !== char.toLowerCase() && before === before.toLowerCase()) return score + CAMEL;
  return score;
}

function isSubsequence(query, lower) {
  let at = 0;
  for (const char of query) {
    at = lower.indexOf(char, at);
    if (at < 0) return false;
    at++;
  }
  return true;
}

// The score of the best way to match, or null. `query` is lowercase.
export function match(query, path) {
  if (!query) return 0;
  const lower = path.toLowerCase();
  if (!isSubsequence(query, lower)) return null;
  const rows = query.length;
  const cols = path.length;
  const nameStart = path.lastIndexOf("/") + 1;
  const scores = Array.from({ length: rows }, () => new Float64Array(cols).fill(NONE));

  for (let row = 0; row < rows; row++) {
    let bestBefore = NONE;
    for (let col = row; col < cols; col++) {
      if (row > 0 && col > 0) bestBefore = Math.max(bestBefore, scores[row - 1][col - 1]);
      if (lower[col] !== query[row]) continue;
      const gain = bonus(path, col, nameStart);
      if (row === 0) { scores[row][col] = gain; continue; }
      scores[row][col] = Math.max(scores[row - 1][col - 1] + gain + RUN, bestBefore + gain);
    }
  }

  const best = Math.max(...scores[rows - 1]);
  if (best === NONE) return null;
  return best - cols * LENGTH_PENALTY - (cols - nameStart) * NAME_LENGTH_PENALTY;
}

// The paths matching `query`, best first.
export function rank(query, paths, limit) {
  const lowered = query.toLowerCase().replace(/\s+/g, "");
  const hits = [];
  for (const path of paths) {
    const score = match(lowered, path);
    if (score !== null) hits.push({ path, score });
  }
  hits.sort((a, b) => b.score - a.score || a.path.length - b.path.length);
  return hits.slice(0, limit);
}
