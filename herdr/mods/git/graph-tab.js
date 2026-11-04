// Opens the Graph tab: one per space, reused if it's already open. Takes the
// herdr module as `herdr`, so node can test it. See git-graph's takeRequest for the other end.
const GRAPH_MOD = "git-graph";
const TAB_NAME = "Graph";
// A pane's props can't change once it's open, so what's asked of the tab goes
// through shared state, by space: { [space]: { seq, folder, commit, tabAskedAt } }.
const OPEN_KEY = "git-graph.open";
// panes() lists a new tab a moment after tab.new: until then, or this long, it's on its way.
const TAB_APPEAR_WAIT = 2000;

// Where the person is working: null when the focus isn't in a terminal, and the
// tab then keeps its folder, or starts on the space's.
function workingFolder({ focused, panes }) {
  const now = focused();
  return panes().find((pane) => pane.pane === now?.pane)?.cwd || now?.cwd || null;
}

// `folder`: the repository to show, by default where the person is working.
// `commit`: a full hash to select and scroll to. Without one, the selection stays.
export function openGraphTab(herdr, { folder = workingFolder(herdr), commit = null } = {}, now = Date.now()) {
  const space = herdr.spaces().find((candidate) => candidate.active);
  if (!space) return;

  const asked = herdr.shared(OPEN_KEY) ?? {};
  const live = Object.fromEntries(herdr.spaces().filter(({ id }) => id in asked).map(({ id }) => [id, asked[id]]));
  const last = asked[space.id];
  const tabs = new Set(space.tabs.map((tab) => tab.id));
  const pane = herdr.panes().find((candidate) => candidate.mod === GRAPH_MOD && tabs.has(candidate.tab));
  const tabOnItsWay = !pane && last?.tabAskedAt !== undefined && now - last.tabAskedAt < TAB_APPEAR_WAIT;
  const tabAskedAt = pane ? undefined : tabOnItsWay ? last.tabAskedAt : now;

  herdr.setShared(OPEN_KEY, { ...live, [space.id]: { seq: (last?.seq ?? 0) + 1, folder, commit, tabAskedAt } });

  if (pane) herdr.run("tab.select", { id: pane.tab });
  else if (!tabOnItsWay) herdr.run("tab.new", { name: TAB_NAME, space: space.id, mod: GRAPH_MOD, props: { space: space.id } });
}
