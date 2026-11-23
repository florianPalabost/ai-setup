import { div } from "gpui-kit";
import { h_flex, v_flex } from "gpui-base";

export const ROW_HEIGHT = 28;

function row(hit, index, selected, t, onPick) {
  const slash = hit.path.lastIndexOf("/");
  const name = hit.path.slice(slash + 1);
  const folder = slash > 0 ? hit.path.slice(0, slash) : "";
  return h_flex().id(`qo-row-${index}`).h(ROW_HEIGHT).flex_none().px(10).gap(10).items_center().rounded(6).cursor_pointer()
    .when(selected, (el) => el.bg(t.selected))
    .hover((s) => s.bg(selected ? t.selected : t.hover))
    .on_click((event, cx) => onPick(index, event, cx))
    .child(div().flex_none().text_color(t.foreground).child(name))
    .child(div().flex_1().min_w(0).truncate().text_size(11.5).text_color(t.dim).child(folder));
}

export function resultList({ hits, at, top, visible, t, onPick }) {
  const shown = hits.slice(top, top + visible);
  return v_flex().gap(0).children(shown.map((hit, offset) => row(hit, top + offset, top + offset === at, t, onPick)));
}

export function scrollTop(top, at, visible, count) {
  const last = Math.max(0, count - visible);
  if (at < top) return at;
  if (at >= top + visible) return Math.min(last, at - visible + 1);
  return Math.min(top, last);
}
