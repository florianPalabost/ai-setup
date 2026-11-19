import { div } from "gpui-kit";
import { h_flex } from "gpui-base";

export const ROW_KIND = Object.freeze({ heading: "heading", name: "name", file: "file", match: "match" });
export const PICKABLE = new Set([ROW_KIND.name, ROW_KIND.match]);
const EXCERPT_FROM_COLUMN = 24;
const CONTEXT = 10;

export function rowsFor(names, found, notes) {
  const rows = [];
  if (names.length) rows.push({ kind: ROW_KIND.heading, label: "Files", note: notes.names });
  rows.push(...names.map(({ path }) => ({ kind: ROW_KIND.name, path, line: 1 })));
  if (found?.count) rows.push({ kind: ROW_KIND.heading, label: "In files", note: notes.content });
  for (const { path, matches } of found?.files ?? []) {
    rows.push({ kind: ROW_KIND.file, path, count: matches.length });
    rows.push(...matches.map((match) => ({ kind: ROW_KIND.match, path, ...match })));
  }
  return rows;
}

function excerpt({ text, column }) {
  const indent = text.length - text.trimStart().length;
  if (column - indent <= EXCERPT_FROM_COLUMN) return text.trimStart();
  return `…${text.slice(column - CONTEXT)}`;
}

function pathParts(path) {
  const slash = path.lastIndexOf("/");
  return { name: path.slice(slash + 1), folder: slash > 0 ? path.slice(0, slash) : "" };
}

function heading(row, t) {
  return h_flex().h(26).mt(6).px(8).gap(8).items_center().text_size(11).text_color(t.dim)
    .child(div().flex_none().font_semibold().child(row.label.toUpperCase()))
    .child(div().flex_1().min_w(0).truncate().text_right().child(row.note ?? ""));
}

function fileLine(row, t) {
  const { name, folder } = pathParts(row.path);
  return h_flex().w_full().gap(7).items_center()
    .child(div().flex_none().text_color(t.foreground).child(name))
    .child(div().flex_1().min_w(0).truncate().text_size(11).text_color(t.dim).child(folder))
    .when(row.count !== undefined, (el) => el.child(div().flex_none().text_size(11).text_color(t.dim).child(String(row.count))));
}

function matchLine(row, t) {
  return h_flex().w_full().gap(7).pl(12).items_center()
    .child(div().w(30).flex_none().text_size(11).text_color(t.dim).child(String(row.line)))
    .child(div().flex_1().min_w(0).truncate().text_size(12).child(excerpt(row)));
}

function pickRow(row, index, selected, t, onPick) {
  return div().id(`find-row-${index}`).h(26).flex_none().px(8).flex().items_center().rounded(6).cursor_pointer()
    .when(selected, (el) => el.bg(t.selected))
    .hover((s) => s.bg(selected ? t.selected : t.hover))
    .on_click((event, cx) => onPick(index, event, cx))
    .child(row.kind === ROW_KIND.match ? matchLine(row, t) : fileLine(row, t));
}

export function rowView(row, index, selected, t, onPick) {
  return row.kind === ROW_KIND.heading ? heading(row, t) : pickRow(row, index, selected, t, onPick);
}
