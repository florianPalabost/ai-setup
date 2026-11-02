// PROTOTYPE (wayfinder "Git panel prototype", throwaway): one Git side panel with
// accordion sections: Changes (a copy of the shipped `changes`), Pull request,
// My PRs & reviews, Commits. "Graph ↗" opens the full graph in a reused tab.
import { View, div } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { theme, spaces, run, notify } from "herdr";
import { Changes } from "./changes.js";
import { PrPane } from "./pr.js";
import { PrsPanel } from "./prs-view.js";
import { Commits } from "./commits.js";
import { stateLabel, GLYPH } from "./pr-data.js";

const SECTIONS = [["changes", "Changes"], ["pr", "Pull request"], ["prs", "My PRs & reviews"], ["commits", "Commits"]];

export default class Git extends View {
  init(p, cx) {
    this.changes = new Changes(); this.changes.embedded = true; this.changes.init(p, cx);
    this.pr = new PrPane(); this.pr.init(p, cx);
    this.prs = new PrsPanel(); this.prs.init(p, cx);
    this.commits = new Commits(); this.commits.init(() => this.changes.root, cx);
    this.commits.onOpen = (hash) => this.openGraph(hash);
    let saved = null;
    try { saved = JSON.parse(localStorage.getItem("accordion") ?? "null"); } catch {}
    this.open = saved?.open ?? { changes: true, pr: true, prs: false, commits: false };
    this.single = saved?.single ?? false;
  }

  save() { try { localStorage.setItem("accordion", JSON.stringify({ open: this.open, single: this.single })); } catch {} }

  toggle(id, cx) {
    const now = !this.open[id];
    if (this.single) for (const k of Object.keys(this.open)) this.open[k] = false;
    this.open[id] = now; this.save(); cx.notify();
  }

  openGraph(hash) {
    const space = spaces().find((s) => s.active);
    const tab = space?.tabs.find((t) => t.named && t.name === "Graph");
    if (tab) run("tab.select", { id: tab.id });
    else run("tab.new", { name: "Graph", mod: "proto-graph-community", props: { folder: this.changes.root ?? undefined } });
    if (hash) notify({ title: "Prototype", body: `Would select ${hash} in the graph (not supported yet).`, timeout: 3000 });
  }

  summary(id, t) {
    if (id === "changes") {
      const f = this.changes.files, add = f.reduce((n, x) => n + x.add, 0), del = f.reduce((n, x) => n + x.del, 0);
      return this.changes.error ? this.changes.error : f.length ? `${f.length} files  +${add} −${del}` : "clean";
    }
    if (id === "pr") {
      const s = this.pr.w.state;
      if (s.kind === "pr") {
        const c = s.pr.checks;
        return `#${s.pr.number} · ${stateLabel(s.pr)[0]}${c.total ? ` · ${GLYPH.fail}${c.fail} ${GLYPH.pending}${c.pending} ${GLYPH.pass}${c.pass}` : ""}`;
      }
      return s.kind === "no-pr" ? "No PR for this branch" : s.kind === "loading" ? "…" : "–";
    }
    if (id === "prs") return this.prs.feed.data ? `${this.prs.feed.count()}` : "…";
    return this.commits.summary();
  }

  part(id) { return { changes: this.changes, pr: this.pr, prs: this.prs, commits: this.commits }[id]; }

  render(cx) {
    const t = theme();
    const pill = (id, label, on, click) => div().id(id).flex_none().px(7).py(2).rounded(5).text_size(11)
      .bg(on ? t.selected : t.chrome).text_color(on ? t.foreground : t.muted).cursor_pointer()
      .hover((s) => s.bg(t.hover)).on_click(click).child(label);
    const top = h_flex().h(36).flex_none().px(10).gap(6).items_center().border_b(1).border_color(t.border)
      .child(div().font_semibold().text_size(13).child("Git"))
      .child(div().text_size(10).text_color(t.ansi3).child("PROTOTYPE"))
      .child(div().flex_1())
      .child(pill("mode", this.single ? "one open" : "several open", false, (_e, cx) => { this.single = !this.single; this.save(); cx.notify(); }))
      .child(pill("graph", "Graph ↗", false, () => this.openGraph(null)));
    const sections = SECTIONS.map(([id, label]) => {
      const on = this.open[id];
      const head = h_flex().id(`hd-${id}`).h(30).flex_none().px(10).gap(6).items_center().border_b(1).border_color(t.border)
        .cursor_pointer().hover((s) => s.bg(t.hover)).on_click((_e, cx) => this.toggle(id, cx))
        .child(div().w(10).text_color(t.dim).child(on ? "▾" : "▸"))
        .child(div().flex_none().font_semibold().text_size(12).child(label))
        .child(div().flex_1().min_w(0).truncate().text_size(11).text_color(t.dim).child(this.summary(id, t)));
      const box = v_flex().id(`sec-${id}`).min_h(0).when(on, (el) => el.flex_1()).when(!on, (el) => el.flex_none()).child(head);
      return on ? box.child(div().id(`body-${id}`).flex_1().min_h(120).overflow_hidden().border_b(1).border_color(t.border).child(this.part(id).render(cx))) : box;
    });
    return v_flex().id("git").size_full().min_h(0).bg(t.surface).text_color(t.foreground).text_size(13).child(top).children(sections);
  }
}
