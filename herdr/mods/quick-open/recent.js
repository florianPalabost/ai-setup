const RECENT_KEY = "quick-open.recent";
const KEEP = 30;

export function recentFiles(herdr, space) {
  return herdr.shared(RECENT_KEY)?.[space] ?? [];
}

export function rememberFile(herdr, space, file) {
  const all = herdr.shared(RECENT_KEY) ?? {};
  const list = [file, ...(all[space] ?? []).filter((kept) => kept !== file)].slice(0, KEEP);
  herdr.setShared(RECENT_KEY, { ...all, [space]: list });
}

export function recentFirst(recent, root, paths) {
  const prefix = `${root}/`;
  const present = new Set(paths);
  const first = recent.filter((file) => file.startsWith(prefix)).map((file) => file.slice(prefix.length)).filter((path) => present.has(path));
  const firstSet = new Set(first);
  return [...first, ...paths.filter((path) => !firstSet.has(path))];
}
