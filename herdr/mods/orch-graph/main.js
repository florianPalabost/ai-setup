import { View, div, PathBuilder } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { exec, spaces, theme, props, checking } from "herdr";
import { DEMO_RUN_ID } from "./demo.mjs";
import { runGraph } from "./run-graph.mjs";
import { buildGraph, layoutGraph, CARD_HEIGHT, EDGE_KINDS, NODE_KINDS } from "./layout.js";

export const RUN_GRAPH_ERROR_CODES = Object.freeze({
  noSpace: "run_graph_no_space",
  cliMissing: "factory_cli_missing",
  cliFailed: "factory_cli_failed",
});

const FACTORY_CLI = "factory";
const CLI_TIMEOUT_MS = 30000;
const POLL_INTERVAL_MS = 5000;
const MARGIN = 16;
const ARROW = 8;
const EDGE_WIDTH = 2;
const RUNNING = "running";

const statusColors = (t) => ({
  running: t.ansi3, done: t.ansi2, pass: t.ansi2, fail: t.ansi1, error: t.ansi1, run: t.ansi6,
});

const runGraphError = (code, message) => Object.assign(new Error(message), { code });

async function loadStatus() {
  const space = spaces().find((candidate) => candidate.active);
  if (!space?.folder) throw runGraphError(RUN_GRAPH_ERROR_CODES.noSpace, "No active space");
  let result;
  try {
    result = await exec(FACTORY_CLI, ["status", "--json", "--local", "--repo", space.folder], { on: space.machine ?? null, timeout: CLI_TIMEOUT_MS });
  } catch (error) {
    throw runGraphError(RUN_GRAPH_ERROR_CODES.cliMissing, `No factory CLI on PATH (run install.sh): ${error?.message ?? error}`);
  }
  if (result.code !== 0) throw runGraphError(RUN_GRAPH_ERROR_CODES.cliFailed, result.stderr.trim() || `factory status exited ${result.code}`);
  return { folder: space.folder, status: JSON.parse(result.stdout) };
}

function shortDuration(milliseconds) {
  const minutes = Math.max(0, Math.round(milliseconds / 60000));
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  return hours < 48 ? `${hours}h ${minutes % 60}m` : `${Math.floor(hours / 24)}d`;
}

function ageLabel(step) {
  if (!step.startedAt) return "";
  const startedAt = new Date(step.startedAt).getTime();
  return step.endedAt ? `took ${shortDuration(new Date(step.endedAt).getTime() - startedAt)}` : `${shortDuration(Date.now() - startedAt)} so far`;
}

export default class OrchGraph extends View {
  init(_props, cx) {
    this.data = null; this.layout = null; this.signature = ""; this.error = null; this.loading = false;
    this.runId = props()?.runId ?? null;
    if (checking()) return;
    this.refresh(cx);
    cx.timer.every(POLL_INTERVAL_MS, (cx) => this.refresh(cx));
  }

  refresh(cx) {
    if (this.loading) return;
    this.loading = true;
    cx.spawn(async (cx) => {
      try {
        const { folder, status } = await loadStatus();
        const data = runGraph(status, { runId: this.runId, folder });
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
        this.error = `${e?.code ?? "error"}: ${e?.message ?? e}`;
      } finally {
        this.loading = false;
        cx.notify();
      }
    });
  }

  show(runId, cx) {
    this.runId = runId;
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
    const steps = this.data?.steps ?? [];
    const done = steps.filter((step) => step.status !== RUNNING).length;
    const status = this.error ? this.error : !this.data ? "Loading…" : !run ? `No factory run in ${this.data.repo ?? "this repo"} yet` : `${done}/${steps.length} steps ended`;
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
      const ended = Boolean(node.run.finishedAt);
      return box.border_color(ended ? colors.done : colors.run).border_l(4)
        .child(div().truncate().font_semibold().child(node.run.objective || node.run.id))
        .child(line(`${node.doneCount}/${node.stepCount} steps ended`, t.dim));
    }
    const { step } = node, color = colors[step.status] ?? t.dim;
    const meta = [step.agent, ageLabel(step), step.detail].filter(Boolean);
    return box.border_color(color).border_l(4)
      .child(div().truncate().child(step.name))
      .child(h_flex().gap(8).text_size(11)
        .child(div().flex_none().text_color(color).child(step.status))
        .child(div().flex_1().min_w(0).truncate().text_color(t.dim).child(meta.join(" · "))));
  }

  render(_cx) {
    const t = theme(), colors = statusColors(t);
    const root = v_flex().id("orch-graph").size_full().min_h(0).bg(t.background).text_color(t.foreground).text_size(13).child(this.header(t));
    if (!this.layout) {
      return root.child(div().p(16).text_color(t.dim).child(this.error ? "Can't read the factory's runs." : this.data ? "No factory run yet. Try the demo." : "Loading…"));
    }
    const { width, height, nodes } = this.layout;
    return root.child(div().id("orch-graph-scroll").flex_1().min_h(0).overflow_scroll()
      .child(div().relative().w(width + MARGIN * 2).h(height + MARGIN * 2)
        .children(this.edges(t, colors))
        .children(nodes.map((node) => this.card(node, t, colors)))));
  }
}
