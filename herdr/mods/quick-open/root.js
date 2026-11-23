const GIT_TIMEOUT_MS = 5000;

function startFolder(herdr) {
  const space = herdr.spaces().find((candidate) => candidate.active);
  const focused = herdr.focused();
  const pane = focused?.pane ? herdr.panes().find((candidate) => candidate.pane === focused.pane) : null;
  const terminalFolder = focused?.pane === null ? focused.cwd : null;
  return pane?.cwd || terminalFolder || space?.folder || null;
}

export async function findRoot(herdr) {
  const folder = startFolder(herdr);
  if (!folder) return null;
  try {
    const result = await herdr.exec("git", ["rev-parse", "--show-toplevel"], { cwd: folder, timeout: GIT_TIMEOUT_MS });
    if (result.code === 0 && result.stdout.trim()) return result.stdout.trim();
  } catch {}
  return folder;
}
