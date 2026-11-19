import { div } from "gpui-kit";
import { h_flex, v_flex } from "gpui-base";

export const ROW_HEIGHT = 26;
export const ROW_KIND = Object.freeze({ file: "file", match: "match" });
const EXCERPT_FROM_COLUMN = 40;
const CONTEXT = 16;

export function rowsFor(files) {
  return files.flatMap(({ path, matches }) => [
    { kind: ROW_KIND.file, path, count: matches.length },
    ...matches.map((match) => ({ kind: ROW_KIND.match, path, ...match })),
  ]);
}

function excerpt({ text, column }) {
  const indent = text.length - text.trimStart().length;
  if (column - indent <= EXCERPT_FROM_COLUMN) return text.trimStart();
  return `…${text.slice(column - CONTEXT)}`;
}

function fileRow(row, t) {
  const slash = row.path.lastIndexOf("/");
  return h_flex().h_full().w_full().gap(8).items_center()
    .child(div().flex_none().text_color(t.foreground).child(row.path.slice(slash + 1)))
    .child(div().flex_1().min_w(0).truncate().text_size(11.5).text_color(t.dim).child(slash > 0 ? row.path.slice(0, slash) : ""))
    .child(div().flex_none().text_size(11).text_color(t.dim).child(String(row.count)));
}

function matchRow(row, t) {
  return h_flex().h_full().w_full().gap(8).pl(14).items_center()
    .child(div().w(36).flex_none().text_size(11).text_color(t.dim).child(String(row.line)))
    .child(div().flex_1().min_w(0).truncate().text_size(12).text_color(t.foreground).child(excerpt(row)));
}

function listRow(row, index, selected, t, onPick) {
  return div().id(`search-row-${index}`).h(ROW_HEIGHT).flex_none().px(10).rounded(6).cursor_pointer()
    .when(selected, (el) => el.bg(t.selected))
    .hover((s) => s.bg(selected ? t.selected : t.hover))
    .on_click((event, cx) => onPick(index, event, cx))
    .child(row.kind === ROW_KIND.file ? fileRow(row, t) : matchRow(row, t));
}

export function resultList({ rows, at, top, visible, t, onPick }) {
  const shown = rows.slice(top, top + visible);
  return v_flex().gap(0).children(shown.map((row, offset) => listRow(row, top + offset, top + offset === at, t, onPick)));
}

export function scrollTop(top, at, visible, count) {
  const last = Math.max(0, count - visible);
  if (at < top) return at;
  if (at >= top + visible) return Math.min(last, at - visible + 1);
  return Math.min(top, last);
}
