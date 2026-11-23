import { withLocalRuns } from "./board.js";

export const FACTORY_ERROR_CODES = Object.freeze({
  cliMissing: "factory_cli_missing",
  cliFailed: "factory_cli_failed",
});

const CONFIG_FILE = ".factory.json";
const FACTORY_CLI = "factory";
const CLI_TIMEOUT_MS = 90000;
const GITHUB_REFRESH_MS = 60000;
const CLEAN_INTERVAL_MS = 10 * 60000;
const REPOS_REFRESH_MS = 5 * 60000;
const SPACE_LOOKUP_REUSE_MS = 5000;

// A main checkout's git dir; a worktree's common dir is its repo's, a submodule's sits elsewhere.
const MAIN_GIT_DIR = /[\\/]\.git$/;

const repoKey = (repo) => `${repo.on ?? ""}\0${repo.root}`;
const sortRepos = (list) => [...list].sort((a, b) => a.name.localeCompare(b.name));

export function spaceFolders(space, allPanes) {
  const tabs = new Set(space.tabs.map((tab) => tab.id));
  return [...new Set([space.folder, ...allPanes.filter((pane) => tabs.has(pane.tab)).map((pane) => pane.cwd)].filter(Boolean))];
}

const factoryError = (code, message) => Object.assign(new Error(message), { code });

// The repo list and the active space's lookup, one for every open copy of the mod: each copy gets its
// own module instances, but globalThis is common to all of them (as in git/shared-result.js).
const SHARED_SLOT = "__factoryBoardShared";
const sharedSlot = (realm) => (realm[SHARED_SLOT] ??= { repos: { at: 0, list: [] }, spaceLookup: null });

export function createFactorySource({ exec, readTextFile, spaces, panes, now = () => Date.now(), realm = globalThis }) {
  const shared = sharedSlot(realm);
  const githubByRoot = new Map();
  const cleaningRoots = new Set();
  const cleanedAt = new Map();
  const freshRoots = new Set();

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

  async function factoryRepoOf(folder, on) {
    const git = await exec("git", ["rev-parse", "--path-format=absolute", "--show-toplevel", "--git-common-dir"], { cwd: folder, on }).catch(() => null);
    if (git?.code !== 0) return null;
    const [top, commonDir] = git.stdout.trim().split("\n");
    const root = MAIN_GIT_DIR.test(commonDir) ? commonDir.replace(MAIN_GIT_DIR, "") : top;
    if ((await readTextFile(`${root}/${CONFIG_FILE}`, { on }).catch(() => null)) === null) return null;
    return { name: root.split("/").at(-1), root, on };
  }

  async function factoryRepos() {
    if (now() - shared.repos.at < REPOS_REFRESH_MS) return shared.repos.list;
    const allPanes = panes();
    const folders = new Map();
    for (const space of spaces()) {
      for (const folder of spaceFolders(space, allPanes)) folders.set(`${space.machine ?? ""}\0${folder}`, { folder, on: space.machine ?? null });
    }
    const found = new Map();
    await Promise.all([...folders.values()].map(async ({ folder, on }) => {
      const repo = await factoryRepoOf(folder, on);
      if (repo) found.set(repoKey(repo), repo);
    }));
    shared.repos = { at: now(), list: sortRepos([...found.values()]) };
    return shared.repos.list;
  }

  async function findRepoOfSpace(space) {
    const on = space.machine ?? null;
    for (const folder of spaceFolders(space, panes())) {
      const repo = await factoryRepoOf(folder, on);
      if (!repo) continue;
      const { list } = shared.repos;
      if (!list.some((known) => repoKey(known) === repoKey(repo))) shared.repos = { ...shared.repos, list: sortRepos([...list, repo]) };
      return repo.root;
    }
    return null;
  }

  function repoOfSpace(space) {
    const recent = shared.spaceLookup;
    if (recent?.spaceId === space.id && now() - recent.at < SPACE_LOOKUP_REUSE_MS) return recent.root;
    const root = findRepoOfSpace(space).catch(() => null);
    shared.spaceLookup = { spaceId: space.id, at: now(), root };
    return root;
  }

  function cleanMergedWorktrees(repo) {
    if (cleaningRoots.has(repo.root) || now() - (cleanedAt.get(repo.root) ?? 0) < CLEAN_INTERVAL_MS) return;
    cleaningRoots.add(repo.root);
    cleanedAt.set(repo.root, now());
    factoryJson(repo, ["clean"]).catch(() => {}).finally(() => cleaningRoots.delete(repo.root));
  }

  async function githubState(repo) {
    const cached = githubByRoot.get(repo.root);
    if (cached && now() - cached.at < GITHUB_REFRESH_MS) return cached;
    cleanMergedWorktrees(repo);
    const skipCache = freshRoots.delete(repo.root);
    const fresh = { at: now(), state: await factoryJson(repo, skipCache ? ["status", "--fresh"] : ["status"]) };
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

  const logPath = async (repo, issueNumber) => (await factoryJson(repo, ["log", String(issueNumber)])).path;

  return {
    getFactory,
    logPath,
    repoOfSpace,
    forgetRepos: () => { shared.repos = { at: 0, list: [] }; shared.spaceLookup = null; },
    forgetGithub: (root) => { githubByRoot.delete(root); freshRoots.add(root); },
  };
}
