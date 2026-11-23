import { TAIL_BYTES, normalizePath, tailLines } from "./text.js";

export const SOURCE_KINDS = Object.freeze({ factory: "factory", laravel: "laravel" });

const FACTORY_CONFIG = ".factory.json";
const FACTORY_CLI = "factory";
const WATCH_LOG = "watch.log";
const CLI_TIMEOUT_MS = 90000;
const GIT_TIMEOUT_MS = 5000;
const FACTORY_REFRESH_MS = 60000;
// The newest of storage/logs/laravel*.log, which the daily channel rolls over to a new file.
const NEWEST_LARAVEL_LOG = 'ls -t "$1"/storage/logs/laravel*.log 2>/dev/null | head -n 1';
const MISSING_EXIT = 3;
const TAIL_SCRIPT = `[ -f "$1" ] || exit ${MISSING_EXIT}; wc -c < "$1"; tail -c ${TAIL_BYTES} "$1"`;

export const factorySourceId = (issueNumber) => `${SOURCE_KINDS.factory}:${issueNumber}`;

function byRunRecency(left, right) {
  const running = Number(!right.run.finishedAt) - Number(!left.run.finishedAt);
  return running || String(right.run.updatedAt ?? right.run.startedAt).localeCompare(String(left.run.updatedAt ?? left.run.startedAt));
}

export function createSourceFinder({ exec, readTextFile, now = () => Date.now() }) {
  const factoryByRoot = new Map();

  async function spaceRoot(space) {
    const on = space.machine ?? null;
    if (!space.folder) return null;
    const top = await exec("git", ["rev-parse", "--show-toplevel"], { cwd: space.folder, on, timeout: GIT_TIMEOUT_MS }).catch(() => null);
    return { root: top?.code === 0 && top.stdout.trim() ? top.stdout.trim() : space.folder, on };
  }

  async function factoryStatus({ root, on }) {
    const cached = factoryByRoot.get(root);
    if (cached && now() - cached.at < FACTORY_REFRESH_MS) return cached.status;
    if ((await readTextFile(`${root}/${FACTORY_CONFIG}`, { on }).catch(() => null)) === null) return null;
    const result = await exec(FACTORY_CLI, ["status", "--json", "--repo", root], { on, timeout: CLI_TIMEOUT_MS }).catch(() => null);
    const status = result?.code === 0 ? JSON.parse(result.stdout) : null;
    factoryByRoot.set(root, { at: now(), status });
    return status;
  }

  async function factorySources(where) {
    const status = await factoryStatus(where);
    return (status?.tickets ?? []).filter((ticket) => ticket.run).sort(byRunRecency).map((ticket) => ({
      id: factorySourceId(ticket.number),
      kind: SOURCE_KINDS.factory,
      label: `#${ticket.number} ${ticket.title}`,
      running: !ticket.run.finishedAt,
      path: normalizePath(`${status.root}/${ticket.run.dir}/${WATCH_LOG}`),
    }));
  }

  async function laravelSources({ root, on }) {
    const result = await exec("sh", ["-c", NEWEST_LARAVEL_LOG, "sh", root], { on }).catch(() => null);
    const path = result?.code === 0 ? result.stdout.trim() : "";
    return path ? [{ id: SOURCE_KINDS.laravel, kind: SOURCE_KINDS.laravel, label: "Laravel", running: false, path }] : [];
  }

  async function find(space) {
    const where = await spaceRoot(space);
    if (!where) return { root: null, on: null, sources: [] };
    const [factory, laravel] = await Promise.all([factorySources(where), laravelSources(where)]);
    return { ...where, sources: [...factory, ...laravel] };
  }

  async function read(source, on) {
    const result = await exec("sh", ["-c", TAIL_SCRIPT, "sh", source.path], { on });
    if (result.code === MISSING_EXIT) return null;
    if (result.code !== 0) throw new Error(result.stderr.trim() || `tail exited ${result.code}`);
    const newline = result.stdout.indexOf("\n");
    const size = Number(result.stdout.slice(0, newline));
    return tailLines(result.stdout.slice(newline + 1), size > TAIL_BYTES);
  }

  return { find, read, forget: () => factoryByRoot.clear() };
}
