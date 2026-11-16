// Turns a run into positioned cards and edges, free of the herdr runtime so it
// can run under `node --test`. The Orca panel lays the same graph out with dagre;
// herdr can't load it, so this is a small layered layout of its own: ranks by
// longest path, top to bottom, ordered by the mean position of each card's parents.

export const CARD_WIDTH = 240;
export const GATE_WIDTH = 200;
export const CARD_HEIGHT = 64;
export const NODE_GAP = 28;
export const RANK_GAP = 56;

export const EDGE_KINDS = Object.freeze({ root: "root", dep: "dep", child: "child", gate: "gate" });
export const NODE_KINDS = Object.freeze({ run: "run", task: "task", gate: "gate" });

// The run is the root, every gate points at the task it blocks, and a task's
// parent points at it with a "child" edge. Same graph as the Orca panel's buildGraph.
export function buildGraph({ run, tasks, gates }) {
  const runNodeId = `run:${run.id}`;
  const taskIds = new Set(tasks.map((task) => task.id));
  const doneCount = tasks.filter((task) => task.status === "completed").length;
  const nodes = [{ id: runNodeId, kind: NODE_KINDS.run, width: CARD_WIDTH, run, doneCount, taskCount: tasks.length }];
  const edges = [];

  for (const task of tasks) {
    nodes.push({ id: task.id, kind: NODE_KINDS.task, width: CARD_WIDTH, task });
    const deps = task.deps.filter((depId) => taskIds.has(depId));
    const hasParent = task.parentId && taskIds.has(task.parentId);
    for (const depId of deps) edges.push({ from: depId, to: task.id, kind: EDGE_KINDS.dep });
    if (hasParent) edges.push({ from: task.parentId, to: task.id, kind: EDGE_KINDS.child });
    if (deps.length === 0 && !hasParent) edges.push({ from: runNodeId, to: task.id, kind: EDGE_KINDS.root });
  }
  for (const gate of gates) {
    if (!taskIds.has(gate.taskId)) continue;
    const gateNodeId = `gate:${gate.id}`;
    nodes.push({ id: gateNodeId, kind: NODE_KINDS.gate, width: GATE_WIDTH, gate });
    edges.push({ from: gateNodeId, to: gate.taskId, kind: EDGE_KINDS.gate });
  }

  return { nodes, edges };
}

// Longest path from the sources, with a gate pulled down to sit just above the task it blocks.
// An edge that would close a cycle is ignored, so bad data still draws.
function ranks(nodes, edges) {
  const incoming = new Map(nodes.map((node) => [node.id, []]));
  for (const edge of edges) incoming.get(edge.to)?.push(edge.from);
  const rank = new Map(), visiting = new Set();
  const rankOf = (id) => {
    if (rank.has(id)) return rank.get(id);
    if (visiting.has(id)) return -1;
    visiting.add(id);
    const parents = incoming.get(id) ?? [];
    const value = parents.length ? Math.max(...parents.map(rankOf)) + 1 : 0;
    visiting.delete(id);
    rank.set(id, value);
    return value;
  };
  for (const node of nodes) rankOf(node.id);
  for (const edge of edges) {
    if (edge.kind === EDGE_KINDS.gate) rank.set(edge.from, Math.max(0, rank.get(edge.to) - 1));
  }
  return rank;
}

// Cards get { x, y } (top-left), edges get their two end points; size is the whole drawing's.
export function layoutGraph({ nodes, edges }) {
  const rank = ranks(nodes, edges);
  const rows = [];
  for (const node of nodes) (rows[rank.get(node.id)] ??= []).push(node);

  const parentsOf = new Map(nodes.map((node) => [node.id, []]));
  for (const edge of edges) parentsOf.get(edge.to)?.push(edge.from);
  const centerX = new Map();
  const rowWidth = (row) => row.reduce((sum, node) => sum + node.width, 0) + NODE_GAP * Math.max(0, row.length - 1);
  const width = Math.max(...rows.filter(Boolean).map(rowWidth));

  const placed = new Map();
  rows.forEach((row, index) => {
    if (!row) return;
    const order = row.map((node, position) => {
      const known = parentsOf.get(node.id).filter((id) => centerX.has(id)).map((id) => centerX.get(id));
      return { node, key: known.length ? known.reduce((a, b) => a + b, 0) / known.length : position * 1e-3 };
    }).sort((a, b) => a.key - b.key).map(({ node }) => node);
    let x = (width - rowWidth(order)) / 2;
    for (const node of order) {
      placed.set(node.id, { ...node, x, y: index * (CARD_HEIGHT + RANK_GAP) });
      centerX.set(node.id, x + node.width / 2);
      x += node.width + NODE_GAP;
    }
  });

  const height = rows.length * CARD_HEIGHT + Math.max(0, rows.length - 1) * RANK_GAP;
  const laidEdges = edges.filter((edge) => placed.has(edge.from) && placed.has(edge.to)).map((edge) => {
    const from = placed.get(edge.from), to = placed.get(edge.to);
    return { ...edge, x1: from.x + from.width / 2, y1: from.y + CARD_HEIGHT, x2: to.x + to.width / 2, y2: to.y };
  });

  return { nodes: [...placed.values()], edges: laidEdges, width, height };
}
