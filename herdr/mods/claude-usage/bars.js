import { div } from "gpui-kit";
import { h_flex, v_flex } from "gpui-base";
import { SHOW_LEFT, SHOW_USED } from "./meter.js";

const WIDTH = 260;
const BAR_HEIGHT = 6;
const SHOW_OPTIONS = [
  { show: SHOW_USED, label: "Used" },
  { show: SHOW_LEFT, label: "Left" },
];

function showSwitch(t, show, onShow) {
  return h_flex().p(2).gap(2).rounded(6).bg(t.raised).children(SHOW_OPTIONS.map((option) => {
    const on = option.show === show;
    return div().id(`show-${option.show}`).px(8).py(2).rounded(4).cursor_pointer().text_size(11)
      .text_color(on ? t.foreground : t.dim).when(on, (el) => el.bg(t.popover))
      .hover((st) => st.text_color(t.foreground))
      .on_click((_e, cx) => onShow(option.show, cx))
      .child(option.label);
  }));
}

function bar(t, toneColor, limit) {
  return v_flex().gap(5)
    .child(h_flex().items_center()
      .child(div().flex_1().text_color(t.foreground).child(limit.name))
      .child(div().text_color(toneColor).child(limit.value)))
    .child(div().h(BAR_HEIGHT).w_full().rounded(BAR_HEIGHT / 2).bg(t.raised)
      .child(div().h_full().w(WIDTH * limit.fill).rounded(BAR_HEIGHT / 2).bg(toneColor)))
    .when(Boolean(limit.resets), (el) => el.child(div().text_size(11).text_color(t.dim).child(limit.resets)));
}

// bars: from limitBars; toneColors: a theme colour per tone; onShow(show, cx) flips used/left.
export function barsPanel(t, bars, toneColors, show, onShow) {
  return v_flex().w(WIDTH + 28).p(14).gap(14).rounded(10).border_1().border_color(t.border).bg(t.popover).shadow_md()
    .text_size(12)
    .child(h_flex().items_center()
      .child(div().flex_1().text_color(t.muted).child("Claude usage"))
      .child(showSwitch(t, show, onShow)))
    .children(bars.map((limit) => bar(t, t[toneColors[limit.tone]], limit)));
}
