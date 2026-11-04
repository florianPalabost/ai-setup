// The Git panel: a header above collapsible sections, listed in section-list.js.
import { View, div } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import * as herdr from "herdr";
import { openGraphTab } from "./graph-tab.js";
import { SECTIONS } from "./section-list.js";
import { loadOpen, toggleOpen } from "./sections.js";

const OPEN_KEY = "sections.open";
const CONTENT_SECTION_MAX_HEIGHT = "40%";

export default class Git extends View {
  init(props, cx) {
    this.parts = Object.fromEntries(SECTIONS.map((section) => [section.id, section.create(props, cx)]));
    this.open = loadOpen(localStorage.getItem(OPEN_KEY), SECTIONS);
  }

  toggle(id, cx) {
    this.open = toggleOpen(this.open, id);
    localStorage.setItem(OPEN_KEY, JSON.stringify(this.open));
    cx.notify();
  }

  section({ id, label, fill }, t, cx) {
    const on = this.open[id], part = this.parts[id];
    part.sync?.(cx);
    const head = h_flex().id(`head-${id}`).h(30).flex_none().px(10).gap(6).items_center().border_b(1).border_color(t.border)
      .cursor_pointer().hover((s) => s.bg(t.hover)).on_click((_e, cx) => this.toggle(id, cx))
      .child(div().w(10).text_color(t.dim).child(on ? "▾" : "▸"))
      .child(div().flex_none().font_semibold().text_size(12).child(label))
      .child(div().flex_1().min_w(0).truncate().text_right().text_size(11).text_color(t.dim).child(part.summary()));
    const box = v_flex().id(`section-${id}`).min_h(0).child(head);
    if (!on) return box.flex_none();
    if (fill) return box.flex_1().child(div().id(`body-${id}`).flex_1().min_h(0).overflow_hidden().border_b(1).border_color(t.border).child(part.render(cx)));
    return box.flex_none().max_h(CONTENT_SECTION_MAX_HEIGHT).child(div().id(`body-${id}`).min_h(0).overflow_y_scroll().border_b(1).border_color(t.border).child(part.render(cx)));
  }

  render(cx) {
    const t = herdr.theme();
    return v_flex().id("git").size_full().min_h(0).bg(t.surface).text_color(t.foreground).text_size(13)
      .child(h_flex().id("git-header").h(36).flex_none().px(10).gap(6).items_center().border_b(1).border_color(t.border)
        .child(div().flex_1().font_semibold().child("Git"))
        .child(div().id("git-graph-open").px(6).py(2).rounded(5).text_size(12).text_color(t.muted).cursor_pointer()
          .hover((s) => s.bg(t.hover).text_color(t.foreground)).on_click(() => openGraphTab(herdr)).child("Graph ↗")))
      .children(SECTIONS.map((section) => this.section(section, t, cx)));
  }
}
