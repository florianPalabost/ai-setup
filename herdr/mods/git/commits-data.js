// The current branch's commits for the Commits section. No herdr imports: exec
// is passed in. Reads only: the section offers nothing that changes the repository.
export const COMMITS_VIEW = Object.freeze({
  LIST: "list",
  NO_COMMITS: "no-commits",
  NOT_GIT: "not-git",
  NO_FOLDER: "no-folder",
  REMOTE: "remote-machine",
  FAILED: "failed",
});

const LIMIT = 40;
const FIELD = "\x1f";
// The subject comes last, so one holding the separator stays whole.
const FORMAT = ["", "%H", "%h", "%ar", "%D", "%s"].join("%x1f");
const LANE_CHAR = 7, LANE_PAD = 6, LANE_MIN = 14, LANE_MAX = 70;

// `git log --graph` prints the lanes, then the format. Rows that only join lanes have no format.
function parseRow(line) {
  const [graph, hash, short, age, refs, ...subject] = line.split(FIELD);
  const lanes = graph.trimEnd();
  if (hash === undefined) return { graph: lanes, hash: null };
  return { graph: lanes, hash, short, age: age.replace(/ ago$/, ""), refs: refs.replace(/^HEAD -> /, ""), subject: subject.join(FIELD) };
}

// One look. Never rejects: `kind` says what was found.
export async function loadCommits(exec, { cwd, on = null }) {
  if (on) return { kind: COMMITS_VIEW.REMOTE, machine: on };
  if (!cwd) return { kind: COMMITS_VIEW.NO_FOLDER };
  try {
    return await readCommits((args) => exec("git", ["--no-optional-locks", ...args], { cwd }));
  } catch (error) {
    return { kind: COMMITS_VIEW.FAILED, message: String(error?.message ?? error) };
  }
}

async function readCommits(git) {
  const top = await git(["rev-parse", "--show-toplevel"]);
  if (top.code !== 0) return { kind: COMMITS_VIEW.NOT_GIT };
  const head = await git(["rev-parse", "--verify", "--quiet", "HEAD"]);
  if (head.code !== 0) return { kind: COMMITS_VIEW.NO_COMMITS };

  const log = await git(["log", "--graph", "--no-color", "--no-show-signature", `-n${LIMIT}`, `--format=${FORMAT}`]);
  if (log.code !== 0) return { kind: COMMITS_VIEW.FAILED, message: log.stderr.trim().split("\n")[0] };
  return { kind: COMMITS_VIEW.LIST, root: top.stdout.trim(), rows: log.stdout.split("\n").filter(Boolean).map(parseRow) };
}

export function emptyText(view) {
  switch (view?.kind) {
    case COMMITS_VIEW.NO_COMMITS: return "No commits yet";
    case COMMITS_VIEW.NOT_GIT: return "Not a git repository";
    case COMMITS_VIEW.NO_FOLDER: return "No folder in this space";
    case COMMITS_VIEW.REMOTE: return `Space on ${view.machine}: commits skipped`;
    case COMMITS_VIEW.FAILED: return view.message;
    default: return "";
  }
}

export function commitsSummary(view) {
  if (view?.kind !== COMMITS_VIEW.LIST) return emptyText(view);
  const [newest] = view.rows;
  return `${newest.short} ${newest.subject}`;
}

export function laneWidth(rows) {
  const widest = Math.max(0, ...rows.map((row) => row.graph.length));
  return Math.min(LANE_MAX, Math.max(LANE_MIN, widest * LANE_CHAR + LANE_PAD));
}
