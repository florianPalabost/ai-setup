// PROTOTYPE (issue #7, throwaway): my PRs and review requests as a sidebar-style
// panel. Open beside a terminal:
//   herdr-app do pane.split '{"direction":"right","mod":"proto-prs-panel"}'
// or as a tab: herdr-app do tab.new '{"mod":"proto-prs-panel"}'
// Narrow (< 420 px) draws two-line rows, wider draws one line per PR.

import { View, div } from "gpui-kit";
import { v_flex, h_flex, Scrollbar } from "gpui-base";
import { theme } from "herdr";
import { Feed, heading, row, empty, failure, openUrl, worktreeStub, mode, nextMode, modeLabel, ago, since } from "./prs.js";

export class PrsPanel {
  init(_props, cx) {
    this.feed = new Feed(cx);
    this.width = 300;
  }

  button(t, id, label, tip, onClick) {
    return div().id(id).px(6).py(2).rounded(5).text_size(11.5).text_color(t.muted)
      .hover((s) => s.bg(t.hover).text_color(t.foreground))
      .tooltip(tip).on_click(onClick).child(label);
  }

  render(cx) {
    const t = theme();
    this.feed.follow(cx);
    const d = this.feed.data;
    const compact = this.width < 420;
    const demo = modeLabel(mode());
    const sections = (d?.sections ?? []).filter((s) => s.rows.length);

    const head = h_flex().h(34).flex_none().px(10).gap(4).items_center().border_b_1().border_color(t.border)
      .child(div().text_size(12.5).font_semibold().text_color(t.foreground).child("Pull requests"))
      .when(Boolean(d?.sections), (el) => el.child(div().text_size(11).text_color(t.dim).child(String(this.feed.count()))))
      .child(div().flex_1())
      .child(this.button(t, "demo", demo ? "demo ●" : "demo", "Cycle: real → fixture → a busy public user", (_e, cx) => { nextMode(); this.feed.shownMode = mode(); this.feed.reload(cx); }))
      .child(this.button(t, "refresh", this.feed.busy ? "…" : "↻", "Refresh now (gh cache 60 s)", (_e, cx) => this.feed.reload(cx)));

    let body;
    if (!d) body = div().p(14).text_size(12).text_color(t.dim).child("Asking GitHub…");
    else if (d.error) body = failure(t, d);
    else if (!sections.length) body = empty(t, d, { compact: true });
    else {
      const list = [];
      for (const s of sections) {
        list.push(heading(t, s, { compact }));
        s.rows.forEach((p, i) => list.push(row(t, p, {
          compact, id: `r-${s.id}-${i}`, showAuthor: s.id === "review",
          onOpen: (p) => openUrl(p.url), onWorktree: worktreeStub,
        })));
      }
      body = div().relative().flex_1().min_h(0)
        .child(v_flex().id("prs-list").size_full().overflow_y_scroll().pb(8).children(list))
        .child(Scrollbar.vertical("prs-list").absolute().inset_0());
    }

    return v_flex().id("root").size_full().bg(t.chrome).text_color(t.foreground)
      .on_size_change((size, cx) => { if (Math.abs(size.width - this.width) > 1) { this.width = size.width; cx.notify(); } })
      .child(head)
      .when(Boolean(demo), (el) => el.child(div().flex_none().px(10).py(3).bg(t.ansi3).text_color(t.background).text_size(10.5).font_semibold().child(demo)))
      .child(v_flex().flex_1().min_h(0).child(body))
      .when(Boolean(d && !d.error), (el) => el.child(
        h_flex().flex_none().h(24).px(10).gap(6).items_center().border_t_1().border_color(t.border).text_size(10.5).text_color(t.dim)
          .child(div().child(`updated ${since(d.at)}`))
          .child(div().flex_1())
          .child(div().child("click: browser · ⎇: worktree"))));
  }
}
