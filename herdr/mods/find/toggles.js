// A copy of search/toggles.js: herdr loads no module from outside a mod's folder.
import { div } from "gpui-kit";
import { h_flex } from "gpui-base";

export const TOGGLES = Object.freeze([
  { option: "regex", label: ".*", key: "r", title: "Regex (Alt+R)" },
  { option: "wholeWord", label: "W", key: "w", title: "Whole word (Alt+W)" },
]);

export function toggleFor(event) {
  if (!event.modifiers.alt || event.modifiers.control) return null;
  return TOGGLES.find((toggle) => toggle.key === event.key) ?? null;
}

function chip(toggle, on, t, onFlip) {
  return div().id(`search-toggle-${toggle.option}`).h(24).min_w(28).px(6).flex().items_center().justify_center()
    .rounded(5).border_1().cursor_pointer().text_size(12)
    .border_color(on ? t.accent : t.border)
    .text_color(on ? t.foreground : t.dim)
    .when(on, (el) => el.bg(t.selected))
    .hover((s) => s.bg(t.hover))
    .tooltip(toggle.title)
    .on_click((_event, cx) => onFlip(toggle.option, cx))
    .child(toggle.label);
}

export function toggleBar({ options, t, onFlip }) {
  return h_flex().flex_none().gap(4).children(TOGGLES.map((toggle) => chip(toggle, options[toggle.option], t, onFlip)));
}
