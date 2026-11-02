// PROTOTYPE (issue #7, throwaway): my PRs and review requests as a popup, like the
// palette. No key is bound; open (and close again) with:
//   herdr-app do mod.open '{"name":"proto-prs-popup"}'
// Keys inside: ↑/↓ choose, Enter browser, w worktree (stub), r refresh, m demo mode, Esc close.

import { View, div } from "gpui-kit";
import { v_flex, h_flex, Scrollbar } from "gpui-base";
import { theme, props, closeOverlay } from "herdr";
import { Feed, heading, row, empty, failure, openUrl, worktreeStub, mode, nextMode, modeLabel, ago, since } from "./prs.js";

export default class PrsPopup extends View {
  init(_props, cx) {
    this.feed = new Feed(cx);
    this.at = 0;
    this.handle = cx.focus_handle();
    this.handle.focus();
    cx.timer.after(300, () => this.handle.focus());
  }

  close() {
    const id = props()?.overlay;
    if (id) closeOverlay(id);
  }

  open(p, close = true) {
    openUrl(p.url);
    if (close) this.close();
  }

  render(cx) {
    const t = theme();
    this.feed.follow(cx);
    const d = this.feed.data;
    const demo = modeLabel(mode());
    const sections = (d?.sections ?? []).filter((s) => s.rows.length);
    const flat = sections.flatMap((s) => s.rows);
    this.at = Math.max(0, Math.min(this.at, flat.length - 1));
    const sel = flat[this.at];

    const list = [];
    let i = 0;
    for (const s of sections) {
      list.push(heading(t, s));
      for (const p of s.rows) {
        const k = i++;
        list.push(row(t, p, {
          id: `p-${k}`, selected: k === this.at, showAuthor: s.id === "review",
          onOpen: (p) => this.open(p), onWorktree: (p) => { worktreeStub(p); this.close(); },
        }));
      }
    }

    let body;
    if (!d) body = div().p(16).text_size(12).text_color(t.dim).child("Asking GitHub…");
    else if (d.error) body = failure(t, d);
    else if (!flat.length) body = empty(t, d);
    // A popup sizes to its content: give the list a real height (picker does the same).
    else body = div().relative().h(Math.min(560, sections.length * 30 + flat.length * 33 + 8))
      .child(v_flex().id("pp-list").size_full().overflow_y_scroll().pb(6).children(list))
      .child(Scrollbar.vertical("pp-list").absolute().inset_0());

    const summary = d?.sections
      ? `${d.sections[0].rows.length} to review · ${d.sections[1].rows.length} to fix · ${d.sections[2].rows.length} waiting · ${d.sections[3].rows.length} drafts`
      : "";

    return v_flex().id("pp").track_focus(this.handle).size_full().min_h(0).bg(t.popover).text_color(t.foreground)
      .on_key_down((e, cx) => {
        const k = e.key;
        if (k === "escape") return this.close();
        if (k === "down" && flat.length) this.at = (this.at + 1) % flat.length;
        else if (k === "up" && flat.length) this.at = (this.at + flat.length - 1) % flat.length;
        else if (k === "enter" && sel) return this.open(sel);
        else if (k === "w" && sel) { worktreeStub(sel); return this.close(); }
        else if (k === "r") this.feed.reload(cx);
        else if (k === "m") { nextMode(); this.feed.shownMode = mode(); this.at = 0; this.feed.reload(cx); }
        else return;
        cx.stop_propagation();
        cx.notify();
      })
      .child(h_flex().flex_none().px(16).pt(14).pb(8).gap(8).items_center()
        .child(div().text_size(15).font_semibold().child("Pull requests"))
        .child(div().text_size(11.5).text_color(t.muted).child(summary))
        .child(div().flex_1())
        .when(Boolean(demo), (el) => el.child(div().px(6).py(1).rounded(4).bg(t.ansi3).text_color(t.background).text_size(10.5).font_semibold().child(demo)))
        .child(div().text_size(11).text_color(t.dim).child(this.feed.busy ? "…" : d ? since(d.at) : "")))
      .child(v_flex().flex_1().min_h(0).child(body))
      .child(h_flex().flex_none().px(16).py(8).border_t_1().border_color(t.border).text_size(11).text_color(t.dim)
        .child(div().flex_1().child("↑↓ choose · ↵ open in browser · w worktree space (stub) · r refresh · m demo · esc close")));
  }
}
