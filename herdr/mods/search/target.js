// A copy of quick-open/target.js: herdr loads no module from outside a mod's folder.
// What the Viewer shows in each space, kept in shared state, and how a pick
// gets there. herdr loads no module from outside a mod's folder, so quick-open,
// search and find keep a copy of this file. Takes the herdr module as `herdr`.
export const VIEWER_MOD = "viewer";
export const TARGETS_KEY = "viewer.targets";
// The Viewer tab of each space, which plain picks go to: { [space]: { claim, before, tab } }.
// A copy cannot ask for its tab, so the copy given `claim` in its props records
// the one Viewer tab that is not among `before`, the tabs there before it.
export const TABS_KEY = "viewer.tabs";
// A popup that closes right after openViewer takes the Viewer's first load down
// with it (it stays on "Loading file…"), so close it this long afterwards.
export const CLOSE_AFTER_OPEN_MS = 300;

// A target: { root, path (relative to root), line (from 1), column?, length? }.
export function targetFor(herdr, space) {
  return herdr.shared(TARGETS_KEY)?.[space] ?? null;
}

export const fileName = (path) => path.split("/").pop();

// The space's Viewer tab, if it is still open.
export function viewerTab(herdr, space) {
  const id = herdr.shared(TABS_KEY)?.[space.id]?.tab;
  const open = space.tabs.some((tab) => tab.id === id);
  return open && herdr.panes().some((pane) => pane.mod === VIEWER_MOD && pane.tab === id) ? id : null;
}

function openTab(herdr, space, target) {
  const id = viewerTab(herdr, space);
  if (id) return herdr.run("tab.select", { id });
  const claim = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  const before = space.tabs.map((tab) => tab.id);
  herdr.setShared(TABS_KEY, { ...(herdr.shared(TABS_KEY) ?? {}), [space.id]: { claim, before, tab: null } });
  herdr.run("tab.new", { name: fileName(target.path), space: space.id, mod: VIEWER_MOD, props: { space: space.id, claim } });
}

// A Pinned Viewer keeps showing `target`: it does not follow picks.
function openPinned(herdr, space, target) {
  const props = { space: space.id, target: { ...target, seq: 1 } };
  herdr.run("tab.new", { name: fileName(target.path), space: space.id, mod: VIEWER_MOD, props });
}

export function openViewer(herdr, target, { newTab = false } = {}) {
  const spaces = herdr.spaces();
  const space = spaces.find((candidate) => candidate.active);
  if (!space) return;
  if (newTab) return openPinned(herdr, space, target);
  const live = new Set(spaces.map((candidate) => candidate.id));
  const targets = Object.fromEntries(Object.entries(herdr.shared(TARGETS_KEY) ?? {}).filter(([id]) => live.has(id)));
  const seq = (targets[space.id]?.seq ?? 0) + 1;
  herdr.setShared(TARGETS_KEY, { ...targets, [space.id]: { ...target, seq } });
  openTab(herdr, space, target);
}
