// Where the Factory board's data comes from: the factory CLI (`factory`, linked
// into ~/.local/bin by install.sh), run in each repo with a .factory.json among
// herdr's spaces. Takes herdr's functions, so node can test it.
import { FACTORY_WORKTREE_PATTERN, withLocalRuns } from "./board.js";

export const FACTORY_ERROR_CODES = Object.freeze({
  cliMissing: "factory_cli_missing",
  cliFailed: "factory_cli_failed",
});

const CONFIG_FILE = ".factory.json";
const FACTORY_CLI = "factory";
const CLI_TIMEOUT_MS = 90000;
const GITHUB_REFRESH_MS = 60000;
const REPOS_REFRESH_MS = 5 * 60000;

const factoryError = (code, message) => Object.assign(new Error(message), { code });

export function createFactorySource({ exec, readTextFile, spaces, panes, now = () => Date.now() }) {
  const githubByRoot = new Map();
  const cleaningRoots = new Set();
  let repos = { at: 0, list: [] };

  async function factoryJson(repo, args) {
    let result;
    try {
      result = await exec(FACTORY_CLI, [...args, "--json", "--repo", repo.root], { on: repo.on, timeout: CLI_TIMEOUT_MS });
    } catch (error) {
      throw factoryError(FACTORY_ERROR_CODES.cliMissing, `No factory CLI on PATH (run install.sh): ${error?.message ?? error}`);
    }
    if (result.code !== 0) throw factoryError(FACTORY_ERROR_CODES.cliFailed, result.stderr.trim() || `factory ${args[0]} exited ${result.code}`);
    return JSON.parse(result.stdout);
  }

  // The repo roots of the folders herdr's spaces work in, with a .factory.json and not a ticket's worktree.
  async function factoryRepos() {
    if (now() - repos.at < REPOS_REFRESH_MS) return repos.list;
    const folders = new Map();
    for (const space of spaces()) folders.set(`${space.machine ?? ""}\0${space.folder}`, { folder: space.folder, on: space.machine ?? null });
    for (const pane of panes()) {
      const space = spaces().find((candidate) => candidate.tabs.some((tab) => tab.id === pane.tab));
      if (pane.cwd) folders.set(`${space?.machine ?? ""}\0${pane.cwd}`, { folder: pane.cwd, on: space?.machine ?? null });
    }
    const found = new Map();
    await Promise.all([...folders.values()].filter(({ folder }) => folder).map(async ({ folder, on }) => {
      const top = await exec("git", ["rev-parse", "--show-toplevel"], { cwd: folder, on }).catch(() => null);
      const root = top?.code === 0 ? top.stdout.trim() : null;
      if (!root || FACTORY_WORKTREE_PATTERN.test(root) || found.has(`${on ?? ""}\0${root}`)) return;
      if ((await readTextFile(`${root}/${CONFIG_FILE}`, { on }).catch(() => null)) === null) return;
      found.set(`${on ?? ""}\0${root}`, { name: root.split("/").at(-1), root, on });
    }));
    repos = { at: now(), list: [...found.values()].sort((a, b) => a.name.localeCompare(b.name)) };
    return repos.list;
  }

  // Removes merged tickets' worktrees in the background, one cleanup per repo at a time; a failure waits for the next refresh.
  function cleanMergedWorktrees(repo) {
    if (cleaningRoots.has(repo.root)) return;
    cleaningRoots.add(repo.root);
    factoryJson(repo, ["clean"]).catch(() => {}).finally(() => cleaningRoots.delete(repo.root));
  }

  // GitHub at most once a minute; the local runs on every call.
  async function githubState(repo) {
    const cached = githubByRoot.get(repo.root);
    if (cached && now() - cached.at < GITHUB_REFRESH_MS) return cached;
    cleanMergedWorktrees(repo);
    const fresh = { at: now(), state: await factoryJson(repo, ["status"]) };
    githubByRoot.set(repo.root, fresh);
    return fresh;
  }

  async function getFactory(root) {
    const list = await factoryRepos();
    const repo = list.find((candidate) => candidate.root === root) ?? list[0];
    const summaries = list.map(({ name, root: repoRoot }) => ({ name, root: repoRoot }));
    if (!repo) return { repos: summaries, repo: null, tickets: [] };
    const [github, local] = await Promise.all([githubState(repo), factoryJson(repo, ["status", "--local"])]);
    return { repos: summaries, repo, tickets: withLocalRuns(github.state.tickets, local.runs), githubCheckedAt: new Date(github.at).toISOString() };
  }

  // Writes the ticket's latest run as Markdown with `factory log` and resolves with its path.
  const logPath = async (repo, issueNumber) => (await factoryJson(repo, ["log", String(issueNumber)])).path;

  return {
    getFactory,
    logPath,
    forgetRepos: () => { repos = { at: 0, list: [] }; },
    // Makes the next getFactory read GitHub again for that repo.
    forgetGithub: (root) => { githubByRoot.delete(root); },
  };
}
