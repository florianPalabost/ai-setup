// Git for the graph, with no herdr imports so node can test it: reading the
// history, the labels on each row and where they sit, and the right-click menus.
// Commands are argv arrays, never a shell line, and none of them writes.

// Reads write nothing under .git (no index refresh or lock, no fsmonitor
// cookie), so the folder watch never wakes for the panel's own reads.
export const READ = ["--no-optional-locks", "-c", "core.fsmonitor=false", "-c", "diff.autoRefreshIndex=false"];
export const STATUS = ["status", "--porcelain=v1", "-z", "--no-renames", "--untracked-files=all"];
export const UNCOMMITTED = "*";
// Git's pretty fields are NUL-free strings; -z terminates each seven-field record.
const FORMAT = "%H%x00%P%x00%an%x00%ae%x00%at%x00%D%x00%s";
const objectId = (s) => typeof s === "string" && /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/.test(s);
const refName = (s) => typeof s === "string" && s.length > 0 && !/^[-/]/.test(s)
  && !/[\x00-\x20\x7f~^:?*\[\\]/.test(s) && !s.includes("..") && !s.includes("@{")
  && s !== "@" && !s.endsWith(".") && s.split("/").every((p) => p && !p.startsWith(".") && !p.endsWith(".lock"));

function checkCommit(commit) {
  if (!objectId(commit?.hash) || !Array.isArray(commit.parents) || !commit.parents.every(objectId)) {
    throw new Error("Invalid commit identity");
  }
}

export function logArgs({ all, remotes, firstParent, limit }) {
  const scope = all ? [...(remotes ? [] : ["--exclude=refs/remotes/*"]), "--exclude=refs/stash", "--all"] : ["HEAD"];
  return ["log", "-z", ...scope, ...(firstParent ? ["--first-parent"] : []), "--date-order", "--decorate=full", `-n${limit}`, `--format=${FORMAT}`];
}

export function parseRefs(text) {
  const refs = [];
  for (let name of text ? text.split(", ") : []) {
    const head = name.startsWith("HEAD -> ");
    if (head) name = name.slice(8);
    if (name === "HEAD") refs.push({ kind: "detached", name: "HEAD" });
    else if (name.startsWith("refs/heads/") && refName(name.slice(11))) refs.push({ kind: "branch", name: name.slice(11), head });
    else if (name.startsWith("tag: refs/tags/") && refName(name.slice(15))) refs.push({ kind: "tag", name: name.slice(15) });
    else if (name.startsWith("refs/remotes/") && !name.endsWith("/HEAD") && refName(name.slice(13))) refs.push({ kind: "remote", name: name.slice(13) });
  }
  return refs;
}

export function parseLog(text) {
  if (!text) return [];
  const fields = text.split("\0");
  if (fields.pop() !== "" || fields.length % 7 !== 0) throw new Error("Invalid history framing");
  const commits = [];
  for (let i = 0; i < fields.length; i += 7) {
    const [hash, parents, author, email, time, refs, subject] = fields.slice(i, i + 7);
    const parsed = parseRefs(refs);
    const commit = { hash, parents: parents ? parents.split(" ") : [], author, email, time: Number(time), refs: parsed, subject,
      head: parsed.some((r) => r.head || r.kind === "detached") };
    checkCommit(commit);
    if (!/^\d+$/.test(time) || !Number.isSafeInteger(commit.time)) throw new Error("Invalid commit time");
    commits.push(commit);
  }
  return commits;
}

// `git status --porcelain=v1 -z --no-renames`: one NUL-terminated "XY path" per file.
export function parseStatus(text) {
  return text.split("\0").filter(Boolean).map((entry) => {
    const xy = entry.slice(0, 2), path = entry.slice(3);
    const status = xy === "??" ? "A" : xy.includes("U") || xy === "AA" || xy === "DD" ? "U" : xy.includes("D") ? "D" : xy.includes("A") ? "A" : "M";
    return { path, status, untracked: xy === "??" };
  });
}

// The working tree's changes as the newest row, drawn dashed to HEAD.
export function withUncommitted(commits, changes, head) {
  if (!changes) return commits;
  return [{ hash: UNCOMMITTED, parents: head ? [head] : [], uncommitted: true, dashed: true, refs: [], head: false,
    subject: `Uncommitted changes (${changes})`, author: "", email: "", time: null }, ...commits];
}

// Labels are drawn at these exact widths (monospace text, fixed padding and
// icon), so a press can be matched to the label under it: a virtual list's
// rows can't hold their own handlers.
export const LABEL = { CHAR: 6.6, PAD: 5, ICON: 13, GAP: 6, MAX: 22, FONT: 11 };
const fit = (s, n) => (s.length > n ? s.slice(0, n - 1) + "…" : s);
const partWidth = (part) => Math.ceil(LABEL.PAD * 2 + (part.icon ? LABEL.ICON : 0) + part.text.length * LABEL.CHAR) + 1;

export function labelsOf(commit, remotesShown = true) {
  const labels = [], remotes = remotesShown ? commit.refs.filter((r) => r.kind === "remote") : [], paired = new Set();
  for (const ref of commit.refs) {
    if (ref.kind === "detached") labels.push({ kind: "head", head: true, parts: [{ kind: "head", name: "HEAD", text: "HEAD" }] });
    if (ref.kind !== "branch") continue;
    // A remote branch with the same name rides on its local branch's label, as in Git Graph.
    const parts = [{ kind: "branch", name: ref.name, text: fit(ref.name, LABEL.MAX), icon: true, head: ref.head }];
    for (const remote of remotes) {
      const slash = remote.name.indexOf("/");
      if (remote.name.slice(slash + 1) !== ref.name || paired.has(remote.name)) continue;
      paired.add(remote.name);
      parts.push({ kind: "remote", name: remote.name, text: fit(remote.name.slice(0, slash), 12) });
    }
    labels.push({ kind: "branch", head: ref.head, parts });
  }
  for (const remote of remotes) if (!paired.has(remote.name)) labels.push({ kind: "remote", parts: [{ kind: "remote", name: remote.name, text: fit(remote.name, LABEL.MAX), icon: true }] });
  for (const ref of commit.refs) if (ref.kind === "tag") labels.push({ kind: "tag", parts: [{ kind: "tag", name: ref.name, text: fit(ref.name, LABEL.MAX), icon: true }] });
  // What's checked out comes first.
  labels.sort((a, b) => Number(Boolean(b.head)) - Number(Boolean(a.head)));
  for (const label of labels) {
    for (const part of label.parts) part.width = partWidth(part);
    label.width = label.parts.reduce((n, p) => n + p.width, 2); // + a 1 px border each side
  }
  return labels;
}

// The label part at `x` in a row whose labels start after a `start`-wide graph
// and are cut off at `limit` (the description column's right edge).
export function hitLabel(labels, x, start, limit = Infinity) {
  if (x >= limit) return null;
  let left = start;
  for (const label of labels ?? []) {
    left += LABEL.GAP;
    if (x >= left && x < left + label.width) {
      let at = left + 1;
      for (const part of label.parts) {
        if (x < at + part.width) return { label, part };
        at += part.width;
      }
      return { label, part: label.parts[label.parts.length - 1] };
    }
    left += label.width;
  }
  return null;
}

const item = (label, icon, action) => ({ label, icon, action });
const copy = (label, text) => item(label, "copy", { type: "copy", text });

// The right-click menu for a commit, a label part or the uncommitted row. The
// fork is read-only: everything here copies a value or shows another panel.
export function menuFor(target) {
  switch (target.kind) {
    case "uncommitted": return [item("Show in Changes panel", "mods/changes/changes.svg", { type: "showChanges" })];
    case "branch":
    case "remote": return [copy("Copy branch name", target.name)];
    case "tag": return [copy("Copy tag name", target.name)];
    default: return [copy("Copy commit hash", target.commit.hash), copy("Copy commit subject", target.commit.subject)];
  }
}

export const menuHeight = (items) => 10 + items.reduce((n, i) => n + (i.separator ? 9 : 30), 0);

// The files a commit changed against its first parent, joined from
// --name-status and --numstat (renames off, so the paths match).
export function fileArgs(commit) {
  checkCommit(commit);
  const range = commit.parents.length ? [commit.parents[0], commit.hash] : null;
  const base = range ? ["diff", "--no-renames", "--no-ext-diff", ...range] : ["diff-tree", "--root", "--no-commit-id", "-r", "--no-renames", commit.hash];
  return { status: [...base, "--name-status"], numstat: [...base, "--numstat"] };
}

export function joinFiles(statusText, numstatText) {
  const stats = new Map();
  for (const line of numstatText.split("\n").filter(Boolean)) {
    const [a, d, ...path] = line.split("\t");
    stats.set(path.join("\t"), { add: Number(a) || 0, del: Number(d) || 0, binary: a === "-" });
  }
  return statusText.split("\n").filter(Boolean).map((line) => {
    const [s, ...path] = line.split("\t"), p = path.join("\t");
    return { path: p, status: s[0], ...(stats.get(p) ?? { add: 0, del: 0 }) };
  });
}

export function diffArgs(commit, path) {
  if (!commit.uncommitted) checkCommit(commit);
  const opts = ["--no-color", "--no-ext-diff", "--no-textconv"];
  if (commit.uncommitted) return ["diff", ...opts, "HEAD", "--", path];
  if (!commit.parents.length) return ["show", ...opts, "--format=", commit.hash, "--", path];
  return ["diff", ...opts, commit.parents[0], commit.hash, "--", path];
}

// Numbers each diff line once, so a frame only draws the rows on screen.
export function diffRows(text) {
  const all = text.replace(/\n$/, "").split("\n"), first = all.findIndex((l) => l.startsWith("@@"));
  if (first < 0) return null;
  let old = 0, next = 0;
  return all.slice(first, first + 3000).map((raw) => {
    const line = raw.length > 2000 ? raw.slice(0, 2000) + "…" : raw;
    const m = /^@@ -(\d+)(?:,\d+)? \+(\d+)/.exec(line);
    if (m) { old = +m[1]; next = +m[2]; return { kind: "@", text: line }; }
    const kind = line[0];
    if (kind === "-") return { kind, number: old++, text: line.slice(1) || " " };
    if (kind === "+") return { kind, number: next++, text: line.slice(1) || " " };
    if (kind === " ") { old++; return { kind, number: next++, text: line.slice(1) || " " }; }
    return { kind: "", text: line };
  });
}
