export const MOD_TABS = Object.freeze({
  runGraph: { mod: "orch-graph", name: "Run graph" },
  factory: { mod: "factory-board", name: "Factory" },
});

export function openModTab(herdr, { mod, name }) {
  const space = herdr.spaces().find((candidate) => candidate.active);
  if (!space) return;
  const tabs = new Set(space.tabs.map((tab) => tab.id));
  const pane = herdr.panes().find((candidate) => candidate.mod === mod && tabs.has(candidate.tab));
  if (pane) herdr.run("tab.select", { id: pane.tab });
  else herdr.run("tab.new", { name, space: space.id, mod });
}
