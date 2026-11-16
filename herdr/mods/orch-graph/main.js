// The run graph: an Orca orchestration run drawn as cards, as the Orca plugin's
// "Run graph" panel does (orca-plugins/orch-dag). The data comes from the same
// run-graph.mjs, through the Orca CLI; layout.js places the cards.
import { View, div, PathBuilder } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { exec, theme, props, checking } from "herdr";
import { DEMO_RUN_ID } from "./demo.mjs";
import { loadGraph } from "./run-graph.mjs";
import { createOrcaCli } from "./orca.js";
import { buildGraph, layoutGraph, CARD_HEIGHT, EDGE_KINDS, NODE_KINDS } from "./layout.js";

const POLL_INTERVAL_MS = 5000;
const RUN_KEY = "orch-graph.run";
const MARGIN = 16;
const ARROW = 8;
const EDGE_WIDTH = 2;
const TERMINAL_STATUSES = new Set(["completed", "failed"]);

const statusColors = (t) => ({
  pending: t.dim, ready: t.ansi4, dispatched: t.ansi3, completed: t.ansi2,
  failed: t.ansi1, blocked: t.ansi5, run: t.ansi6, gate: t.ansi11 ?? t.ansi3,
});

function parseTimestamp(value) {
  if (!value) return null;
  return new Date(value.includes("T") ? value : `${value.replace(" ", "T")}Z`).getTime();
}

function shortDuration(milliseconds) {
  const minutes = Math.max(0, Math.round(milliseconds / 60000));
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  return hours < 48 ? `${hours}h ${minutes % 60}m` : `${Math.floor(hours / 24)}d`;
}

function ageLabel(task) {
  const createdAt = parseTimestamp(task.createdAt);
  if (!createdAt) return "";
  const completedAt = parseTimestamp(task.completedAt);
  return completedAt ? `took ${shortDuration(completedAt - createdAt)}` : `${shortDuration(Date.now() - createdAt)} old`;
}

export default class OrchGraph extends View {
  init(_props, cx) {
    this.orca = createOrcaCli(exec);
    this.data = null; this.layout = null; this.signature = ""; this.error = null; this.loading = false;
    this.runId = props()?.runId ?? localStorage.getItem(RUN_KEY) ?? null;
    if (checking()) return;
    this.refresh(cx);
    cx.timer.every(POLL_INTERVAL_MS, (cx) => this.refresh(cx));
  }

  refresh(cx) {
    if (this.loading) return;
    this.loading = true;
    cx.spawn(async (cx) => {
      try {
        const data = await loadGraph(this.orca.orchestration, { runId: this.runId });
        this.error = null;
        const graph = data.run ? buildGraph(data) : null;
        const signature = JSON.stringify(graph && [graph.nodes.map(({ id, kind }) => [id, kind]), graph.edges]);
        if (signature !== this.signature) { this.layout = graph && layoutGraph(graph); this.signature = signature; }
        else if (graph && this.layout) {
          const byId = new Map(graph.nodes.map((node) => [node.id, node]));
          this.layout.nodes = this.layout.nodes.map((node) => ({ ...node, ...byId.get(node.id), x: node.x, y: node.y }));
        }
        this.data = data;
      } catch (e) {
        this.error = e?.message ?? String(e);
      } finally {
        this.loading = false;
        cx.notify();
      }
    });
  }

  show(runId, cx) {
    this.runId = runId;
    localStorage.setItem(RUN_KEY, runId);
    this.signature = "";
    this.refresh(cx);
  }

  pick(by, cx) {
    const runs = this.data?.runs ?? [];
    if (!runs.length) return;
    const index = runs.findIndex((run) => run.id === this.data.run?.id);
    this.show(runs[(index + by + runs.length) % runs.length].id, cx);
  }

  header(t) {
    const run = this.data?.run;
    const tasks = this.data?.tasks ?? [];
    const done = tasks.filter((task) => TERMINAL_STATUSES.has(task.status)).length;
    const status = this.error ? this.error : !this.data ? "Loading…" : !run ? "No orchestration run yet" : `${done}/${tasks.length} tasks ended`;
    const button = (id, label, onClick) => div().id(id).flex_none().px(6).py(2).rounded(5).text_color(t.muted).cursor_pointer()
      .hover((s) => s.bg(t.hover).text_color(t.foreground)).on_click((_e, cx) => onClick(cx)).child(label);
    const header = h_flex().id("orch-graph-header").h(36).flex_none().px(10).gap(6).items_center().border_b(1).border_color(t.border)
      .child(div().flex_none().font_semibold().child("Run graph"))
      .child(button("run-prev", "‹", (cx) => this.pick(-1, cx)))
      .child(div().flex_1().min_w(0).truncate().child(run?.objective || run?.id || "—"))
      .child(button("run-next", "›", (cx) => this.pick(1, cx)))
      .child(div().flex_none().text_size(11).text_color(this.error ? t.ansi1 : t.dim).child(status));
    return this.data?.run?.id === DEMO_RUN_ID ? header : header.child(button("run-demo", "Demo", (cx) => this.show(DEMO_RUN_ID, cx)));
  }

  edges(t, colors) {
    const paths = new Map();
    const style = {
      [EDGE_KINDS.root]: { color: t.dim, dashed: false },
      [EDGE_KINDS.dep]: { color: t.muted, dashed: false },
      [EDGE_KINDS.child]: { color: t.dim, dashed: true },
      [EDGE_KINDS.gate]: { color: colors.gate, dashed: true },
    };
    // Coordinates as percentages of the drawing: paint_path's pixels follow neither the zoom nor the display's scale.
    const { width, height } = this.layout;
    const px = (v) => `${((v + MARGIN) / (width + MARGIN * 2)) * 100}%`, py = (v) => `${((v + MARGIN) / (height + MARGIN * 2)) * 100}%`;
    for (const edge of this.layout.edges) {
      const { color, dashed } = style[edge.kind];
      const key = `${color}${dashed ? "-" : ""}`;
      let line = paths.get(key)?.line ?? (dashed ? PathBuilder.stroke(EDGE_WIDTH).dash_array([5, 5]) : PathBuilder.stroke(EDGE_WIDTH));
      const mid = (edge.y1 + edge.y2 - ARROW) / 2;
      line = line.move_to(px(edge.x1), py(edge.y1)).cubic_bezier_to(px(edge.x2), py(edge.y2 - ARROW), px(edge.x1), py(mid), px(edge.x2), py(mid));
      const head = (paths.get(key)?.head ?? PathBuilder.fill())
        .add_polygon([[px(edge.x2 - ARROW / 2), py(edge.y2 - ARROW)], [px(edge.x2 + ARROW / 2), py(edge.y2 - ARROW)], [px(edge.x2), py(edge.y2)]], true);
      paths.set(key, { line, head, color });
    }
    return [...paths.values()].flatMap(({ line, head, color }) => [line, head].map((path) =>
      window.paint_path(path.build(), color).absolute().top(0).left(0).size_full()));
  }

  card(node, t, colors) {
    const box = v_flex().id(`card-${node.id}`).absolute().left(node.x + MARGIN).top(node.y + MARGIN).w(node.width).h(CARD_HEIGHT)
      .px(10).py(6).gap(4).rounded(8).bg(t.surface).border(1).overflow_hidden();
    const line = (text, color) => div().truncate().text_size(11).text_color(color).child(text);
    if (node.kind === NODE_KINDS.run) {
      const done = node.taskCount > 0 && node.doneCount === node.taskCount;
      return box.border_color(done ? colors.completed : colors.run).border_l(4)
        .child(div().truncate().font_semibold().child(node.run.objective || node.run.id))
        .child(line(`${node.doneCount}/${node.taskCount} completed`, t.dim));
    }
    if (node.kind === NODE_KINDS.gate) {
      const open = node.gate.status === "pending";
      return box.border_color(open ? colors.gate : t.border).border_l(4)
        .child(line(open ? "⚠ Gate · waiting for you" : `✓ Gate · ${node.gate.resolution ? `→ ${node.gate.resolution}` : "resolved"}`, open ? colors.gate : t.dim))
        .child(div().truncate().child(node.gate.question));
    }
    const { task } = node, color = colors[task.status] ?? t.dim;
    const meta = [task.status, task.outcome && task.outcome !== "succeeded" ? task.outcome : null, task.agent, ageLabel(task)].filter(Boolean);
    return box.border_color(color).border_l(4)
      .child(div().truncate().child(task.name))
      .child(h_flex().gap(8).text_size(11)
        .child(div().flex_none().text_color(color).child(meta[0]))
        .child(div().flex_1().min_w(0).truncate().text_color(t.dim).child(meta.slice(1).join(" · "))));
  }

  render(_cx) {
    const t = theme(), colors = statusColors(t);
    const root = v_flex().id("orch-graph").size_full().min_h(0).bg(t.background).text_color(t.foreground).text_size(13).child(this.header(t));
    if (!this.layout) {
      return root.child(div().p(16).text_color(t.dim).child(this.error ? "Can't read Orca's orchestration runs." : this.data ? "No orchestration run yet. Try the demo." : "Loading…"));
    }
    const { width, height, nodes } = this.layout;
    return root.child(div().id("orch-graph-scroll").flex_1().min_h(0).overflow_scroll()
      .child(div().relative().w(width + MARGIN * 2).h(height + MARGIN * 2)
        .children(this.edges(t, colors))
        .children(nodes.map((node) => this.card(node, t, colors)))));
  }
}
