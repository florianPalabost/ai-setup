// PROTOTYPE (wayfinder #6), placement 1: a thin strip meant to sit in a bar
// (under the tab bar, or as the status bar). Opened as a tab/pane for testing,
// it draws the 32 px strip at the top and explains the rest of the block.
//
// Click the PR number/title: opens the PR in the browser.
// Click the checks counts: opens proto-pr-pane as a popup (the checks list).
// Click ↻: refresh now (no gh cache).

import { View, div } from "gpui-kit";
import { h_flex, v_flex } from "gpui-base";
import { theme, openOverlay } from "herdr";
import { PrWatcher, openUrl, tones, GLYPH, SPIN, stateLabel, reviewLabel, emptyText } from "./pr-data.js";

const HEIGHT = 32;

export default class ProtoPrStrip extends View {
  init(_props, cx) {
    this.w = new PrWatcher();
    this.w.start(cx);
  }

  chip(t, text, color) {
    return div().flex_none().px(6).py(1).rounded(4).border(1).border_color(color).text_color(color).text_size(11).child(text);
  }

  checks(t, c) {
    const tone = tones(t);
    if (!c.total) return div().flex_none().text_color(t.dim).child("no checks");
    const part = (b, n) => n > 0 && h_flex().gap(3).items_center().text_color(tone[b])
      .when(b === "pending", (el) => el.child(div().frames(SPIN, 90)))
      .when(b !== "pending", (el) => el.child(GLYPH[b])).child(String(n));
    return h_flex().id("checks").flex_none().gap(8).px(6).py(2).rounded(4).cursor_pointer()
      .hover((s) => s.bg(t.hover))
      .on_click(() => openOverlay({ mod: "proto-pr-pane", kind: "popup", width: 560, height: 0.6, props: { from: "strip" } }))
      .children([part("fail", c.fail), part("pending", c.pending), part("pass", c.pass), part("skip", c.skip)].filter(Boolean));
  }

  strip(t) {
    const s = this.w.state, tone = tones(t);
    const bar = h_flex().h(HEIGHT).flex_none().w_full().px(12).gap(10).items_center()
      .bg(t.chrome).border_b(1).border_color(t.border).text_size(12).text_color(t.muted);
    const where = s.repo ? div().flex_none().text_color(t.dim).child(`${s.repo} · ${s.branch}`) : null;
    const refresh = div().id("refresh").flex_none().px(4).rounded(4).cursor_pointer().text_color(t.dim)
      .hover((x) => x.bg(t.hover).text_color(t.foreground))
      .on_click((_e, cx) => this.w.refresh(cx, "manual"))
      .when(this.w.loading, (el) => el.frames(SPIN, 90))
      .when(!this.w.loading, (el) => el.child("↻"));

    if (s.kind !== "pr") {
      return bar.when(Boolean(where), (el) => el.child(where))
        .child(div().flex_1().min_w(0).truncate().text_color(s.kind === "error" ? tone.fail : t.muted)
          .child(emptyText(s)))
        .when(s.kind === "no-pr", (el) => el.child(div().id("compare").flex_none().cursor_pointer().text_color(t.accent)
          .hover((x) => x.text_color(t.foreground))
          .on_click(() => openUrl(s.compareUrl)).child("Create PR ↗")))
        .child(refresh);
    }

    const pr = s.pr, [label, key] = stateLabel(pr), review = reviewLabel(pr.review);
    return bar
      .child(where)
      .child(h_flex().id("open-pr").flex_1().min_w(0).gap(6).items_center().cursor_pointer()
        .hover((x) => x.text_color(t.foreground))
        .on_click(() => openUrl(pr.url))
        .child(div().flex_none().font_semibold().text_color(t.foreground).child(`#${pr.number}`))
        .child(div().min_w(0).truncate().child(pr.title)))
      .child(this.chip(t, label, tone[key]))
      .when(Boolean(review), (el) => el.child(div().flex_none().text_size(11).text_color(tone[review[1]]).child(review[0])))
      .when(pr.merge === "DIRTY", (el) => el.child(div().flex_none().text_size(11).text_color(tone.fail).child("conflicts")))
      .child(this.checks(t, pr.checks))
      .child(refresh);
  }

  render() {
    const t = theme();
    return v_flex().size_full().bg(t.canvas)
      .child(this.strip(t))
      .child(v_flex().flex_1().p(16).gap(6).text_size(12).text_color(t.dim)
        .child("PROTOTYPE proto-pr-strip: only the 32 px strip above is the design.")
        .child("In a real layout this mod would be a { px: 32 } block under the tab bar or in the status bar.")
        .child(`Last look: ${this.w.reason ?? "–"} · ${this.w.state.meta ? `${this.w.state.meta.ms} ms, cost ${this.w.state.meta.cost}, ${this.w.state.meta.remaining} left` : "no gh call"}`));
  }
}
