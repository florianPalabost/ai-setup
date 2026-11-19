// A copy of quick-open/target.js: herdr loads no module from outside a mod's folder.
// What the Viewer shows in each space, kept in shared state, and how a pick
// gets there. herdr loads no module from outside a mod's folder, so quick-open
// and search keep a copy of this file. Takes the herdr module as `herdr`.
export const VIEWER = Object.freeze({ mod: "viewer", name: "Viewer" });
export const TARGETS_KEY = "viewer.targets";
// A popup that closes right after openViewer takes the Viewer's first load down
// with it (it stays on "Loading file…"), so close it this long afterwards.
export const CLOSE_AFTER_OPEN_MS = 300;

// A target: { root, path (relative to root), line (from 1), column?, length? }.
export function targetFor(herdr, space) {
  return herdr.shared(TARGETS_KEY)?.[space] ?? null;
}

function openTab(herdr, space) {
  const tabs = new Set(space.tabs.map((tab) => tab.id));
  const pane = herdr.panes().find((candidate) => candidate.mod === VIEWER.mod && tabs.has(candidate.tab));
  if (pane) herdr.run("tab.select", { id: pane.tab });
  else herdr.run("tab.new", { name: VIEWER.name, space: space.id, mod: VIEWER.mod, props: { space: space.id } });
}

export function openViewer(herdr, target) {
  const spaces = herdr.spaces();
  const space = spaces.find((candidate) => candidate.active);
  if (!space) return;
  const live = new Set(spaces.map((candidate) => candidate.id));
  const targets = Object.fromEntries(Object.entries(herdr.shared(TARGETS_KEY) ?? {}).filter(([id]) => live.has(id)));
  const seq = (targets[space.id]?.seq ?? 0) + 1;
  herdr.setShared(TARGETS_KEY, { ...targets, [space.id]: { ...target, seq } });
  openTab(herdr, space);
}
