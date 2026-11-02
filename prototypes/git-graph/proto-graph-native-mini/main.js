// PROTOTYPE (wayfinder #5): a minimal native lane view, written from scratch to
// judge how much work a custom graph is. Throwaway.
//
// Repo: props.folder, else the focused pane's folder. Reads `git log` once
// (and on Refresh). Lanes are drawn with paint_path in a virtual list. Clicking
// a commit opens `git show` for it in a terminal to the right (read-only).
// No network, no writes, no folder watch, no labels hit-testing, no details pane.
import { View, div, PathBuilder } from "gpui-kit";
import { v_flex, h_flex, v_virtual_list, Scrollbar } from "gpui-base";
import { props, focused, panes, exec, run, theme, settings } from "herdr";

const LIMIT = 500, ROW = 22, LANE = 12, PAD = 6;
const READ = ["--no-optional-locks", "-c", "core.fsmonitor=false"];

// Newest first, children before parents (--date-order). Each lane waits for one hash.
function layout(commits) {
  const lanes = [];
  let width = 1;
  const rows = commits.map((c) => {
    const before = lanes.slice(), segs = [];
    let lane = before.indexOf(c.hash);
    if (lane < 0) { lane = lanes.indexOf(null); if (lane < 0) lane = lanes.length; lanes[lane] = c.hash; }
    before.forEach((h, j) => {
      if (h == null) return;
      if (h === c.hash) { segs.push([j, 0, lane, 0.5, j]); if (j !== lane) lanes[j] = null; }
      else segs.push([j, 0, j, 1, j]);
    });
    const [first, ...rest] = c.parents;
    lanes[lane] = first ?? null;
    if (first) segs.push([lane, 0.5, lane, 1, lane]);
    for (const p of rest) {
      let k = lanes.indexOf(p);
      if (k < 0) { k = lanes.indexOf(null); if (k < 0) k = lanes.length; lanes[k] = p; }
      segs.push([lane, 0.5, k, 1, k]);
    }
    while (lanes.length && lanes[lanes.length - 1] === null) lanes.pop();
    width = Math.max(width, before.length, lanes.length);
    return { lane, segs };
  });
  return { rows, width };
}

export default class ProtoGraphNativeMini extends View {
  init(_props, cx) {
    this.folder = props()?.folder ?? null;
    this.listId = `mini-rows-${Math.random().toString(36).slice(2)}`;
    this.commits = []; this.rows = []; this.width = 1; this.state = "loading";
    this.load(cx);
  }

  cwd() {
    if (this.folder) return this.folder;
    const f = focused(), p = f?.pane ? panes().find((x) => x.pane === f.pane) : null;
    return p?.cwd ?? f?.cwd ?? null;
  }

  load(cx) {
    const cwd = this.cwd();
    if (!cwd) { this.state = "nofolder"; return; }
    this.state = "loading";
    cx.spawn(async (cx) => {
      const t0 = Date.now();
      const r = await exec("git", [...READ, "log", "--all", "--exclude=refs/stash", "--date-order", `-n${LIMIT}`,
        "--format=%H%x1f%P%x1f%D%x1f%s%x1f%ar%x1e"], { cwd });
      const t1 = Date.now();
      if (r.code !== 0) { this.state = "error"; this.error = r.stderr.trim(); cx.notify(); return; }
      this.commits = r.stdout.split("\x1e").map((s) => s.replace(/^\n/, "")).filter(Boolean).map((rec) => {
        const [hash, parents, refs, subject, ago] = rec.split("\x1f");
        return { hash, parents: parents ? parents.split(" ") : [], refs, subject, ago };
      });
      const { rows, width } = layout(this.commits);
      this.rows = rows; this.width = width; this.root = cwd;
      this.timing = `git ${t1 - t0} ms, layout ${Date.now() - t1} ms, ${this.commits.length} commits, ${width} lanes`;
      this.state = "ready";
      cx.notify();
    });
  }

  show(hash) {
    run("terminal.open", { argv: ["sh", "-c", `git show --stat --patch --color=always ${hash} | less -RS`],
      folder: this.root, place: "right", name: `show ${hash.slice(0, 8)}` });
  }

  cell(row, t, colors, graphW) {
    const z = settings().zoom ?? 1, x = (l) => (PAD + l * LANE + LANE / 2) * z, y = (v) => v * ROW * z;
    const byColor = new Map();
    for (const [a, ya, b, yb, c] of row.segs) {
      const color = colors[c % colors.length];
      let p = byColor.get(color) ?? PathBuilder.stroke(1.5 * z);
      p = p.move_to(x(a), y(ya));
      if (a === b) p = p.line_to(x(b), y(yb));
      else { const mid = (y(ya) + y(yb)) / 2; p = p.cubic_bezier_to(x(b), y(yb), x(a), mid, x(b), mid); }
      byColor.set(color, p);
    }
    return div().relative().flex_none().w(graphW).h(ROW).overflow_hidden()
      .children([...byColor].map(([color, p]) => window.paint_path(p.build(), color).absolute().top(0).left(0).size_full()))
      .child(div().absolute().left(PAD + row.lane * LANE + LANE / 2 - 4).top(ROW / 2 - 4).size(8).rounded(4).bg(colors[row.lane % colors.length]));
  }

  render(cx) {
    const t = theme(), mono = settings().font_family ?? "JetBrains Mono";
    const colors = [t.ansi4, t.ansi2, t.ansi5, t.ansi3, t.ansi6, t.ansi1, t.ansi12, t.ansi10, t.ansi13, t.ansi11];
    const graphW = Math.min(PAD * 2 + this.width * LANE, 240);
    const head = h_flex().h(32).flex_none().px(10).gap(10).items_center().border_b(1).border_color(t.border)
      .child(div().font_semibold().child("proto-graph-native-mini"))
      .child(div().flex_1().min_w(0).truncate().text_color(t.dim).text_size(11).child(this.timing ?? ""))
      .child(div().id("mini-refresh").px(8).py(2).rounded(5).cursor_pointer().text_color(t.muted).hover((s) => s.bg(t.hover))
        .on_click((_e, cx) => { this.load(cx); cx.notify(); }).child("Refresh"));
    const root = v_flex().id("mini-root").size_full().min_h(0).bg(t.background).text_color(t.foreground).text_size(12).child(head);
    if (this.state !== "ready") {
      return root.child(div().p(14).text_color(t.muted).child(this.state === "error" ? this.error : this.state === "nofolder" ? "Focus a terminal in a repo." : "Loading…"));
    }
    return root.child(div().flex_1().min_h(0).relative()
      .child(v_virtual_list(this.listId, this.commits.length, ROW, (i) => this.commits[i].hash, (range) => {
        const out = [];
        for (let i = range.start; i < range.end; i++) {
          const c = this.commits[i];
          out.push(h_flex().id(`m-${c.hash}`).w_full().h(ROW).flex_none().pr(10).gap(6).items_center().overflow_hidden().hover((s) => s.bg(t.hover))
            .child(this.cell(this.rows[i], t, colors, graphW))
            .when(Boolean(c.refs), (e) => e.child(div().flex_none().max_w(260).truncate().px(5).rounded(4).border_1().border_color(t.ansi3)
              .text_color(t.ansi3).font_family(mono).text_size(10.5).child(c.refs)))
            .child(div().flex_1().min_w(0).truncate().child(c.subject))
            .child(div().flex_none().w(90).text_right().truncate().text_color(t.dim).child(c.ago))
            .child(div().flex_none().w(64).font_family(mono).text_size(11).text_color(t.dim).child(c.hash.slice(0, 8))));
        }
        return out;
      }).on_item_click((key) => this.show(key)).size_full())
      .child(Scrollbar.vertical(this.listId).viewport_from_layout().absolute().inset_0()));
  }
}
