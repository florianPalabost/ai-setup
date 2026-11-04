// Opens the Graph tab: one per space, reused if it's already open. Takes the
// herdr module as `herdr`, so node can test it. See git-graph's takeRequest for the other end.
const GRAPH_MOD = "git-graph";
const TAB_NAME = "Graph";
// A pane's props can't change once it's open, so what's asked of the tab goes
// through shared state, by space: { [space]: { seq, folder, commit } }.
const OPEN_KEY = "git-graph.open";

// Where the person is working: null when the focus isn't in a terminal, and the
// tab then keeps its folder, or starts on the space's.
function workingFolder({ focused, panes }) {
  const now = focused();
  return panes().find((pane) => pane.pane === now?.pane)?.cwd || now?.cwd || null;
}

// `folder`: the repository to show, by default where the person is working.
// `commit`: a full hash to select and scroll to. Without one, the selection stays.
export function openGraphTab(herdr, { folder = workingFolder(herdr), commit = null } = {}) {
  const space = herdr.spaces().find((candidate) => candidate.active);
  if (!space) return;

  const asked = herdr.shared(OPEN_KEY) ?? {};
  const live = Object.fromEntries(herdr.spaces().filter(({ id }) => id in asked).map(({ id }) => [id, asked[id]]));
  herdr.setShared(OPEN_KEY, { ...live, [space.id]: { seq: (asked[space.id]?.seq ?? 0) + 1, folder, commit } });

  const tabs = new Set(space.tabs.map((tab) => tab.id));
  const pane = herdr.panes().find((candidate) => candidate.mod === GRAPH_MOD && tabs.has(candidate.tab));
  if (pane) herdr.run("tab.select", { id: pane.tab });
  else herdr.run("tab.new", { name: TAB_NAME, space: space.id, mod: GRAPH_MOD, props: { space: space.id } });
}
