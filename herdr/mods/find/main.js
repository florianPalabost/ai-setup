import { View, div } from "gpui-kit";
import { v_flex, h_flex, InputState, Input, ScrollHandle } from "gpui-base";
import * as herdr from "herdr";
import { findRoot } from "./root.js";
import { listFiles } from "./files.js";
import { rank } from "./fuzzy.js";
import { search } from "./rg.js";
import { rowsFor, rowView, ROW_KIND, PICKABLE } from "./list.js";
import { toggleBar, toggleFor } from "./toggles.js";
import { openViewer } from "./target.js";
import { openInVsCode } from "./vscode.js";

const TYPING_PAUSE_MS = 200;
const NAME_LIMIT = 8;
const PANEL_MATCH_LIMIT = 500;

const plural = (count, one, many) => `${count.toLocaleString("en")} ${count === 1 ? one : many}`;
const describe = (error) => `${error?.message ?? error}${error?.code ? ` (${error.code})` : ""}`;

function rootKey() {
  const space = herdr.spaces().find((candidate) => candidate.active);
  const focused = herdr.focused();
  return `${space?.id}:${focused?.pane ?? focused?.cwd ?? ""}`;
}

export default class Find extends View {
  init(_props, cx) {
    this.query = ""; this.options = { regex: false, wholeWord: false };
    this.root = null; this.rootKey = null; this.names = []; this.found = null; this.rows = []; this.at = -1;
    this.error = null; this.running = false; this.latestRun = 0; this.pending = null;
    this.scroll = ScrollHandle.new();
    this.handle = cx.focus_handle();
    this.input = InputState.new({ placeholder: "Find files and text…" });
    this.input.on("change", (_event, cx) => { this.query = this.input.value(); this.schedule(cx); });
    this.input.on("submit", (event) => this.pick(this.at, { vscode: event.secondary, newTab: event.shift }));
  }

  async close() {
    this.pending?.cancel();
  }

  schedule(cx) {
    this.pending?.cancel();
    this.latestRun++;
    this.running = Boolean(this.query);
    this.pending = cx.timer.after(TYPING_PAUSE_MS, (cx) => this.run(cx));
    cx.notify();
  }

  run(cx) {
    const run = this.latestRun;
    const query = this.query;
    if (!query) return this.show({ names: [], found: null, error: null }, cx);
    cx.spawn(async (cx) => {
      const result = { names: [], found: null, error: null };
      try {
        const root = await findRoot(herdr);
        if (run !== this.latestRun) return;
        this.root = root;
        if (!root) throw new Error("No folder here");
        const [paths, found] = await Promise.all([
          listFiles(herdr.exec, root),
          search(herdr.exec, root, query, { ...this.options, limit: PANEL_MATCH_LIMIT }),
        ]);
        result.names = rank(query, paths, NAME_LIMIT);
        result.found = found;
      } catch (error) {
        result.error = describe(error);
      }
      if (run === this.latestRun) this.show(result, cx);
    });
  }

  show({ names, found, error }, cx) {
    this.running = false;
    this.names = names; this.found = found; this.error = error;
    this.rows = rowsFor(names, found, this.notes());
    this.at = this.nextPickable(0, 1);
    cx.notify();
  }

  notes() {
    const names = this.names.length === NAME_LIMIT ? `best ${NAME_LIMIT}` : "";
    if (!this.found?.count) return { names, content: "" };
    const { count, files, capped } = this.found;
    const content = `${plural(count, "match", "matches")} · ${plural(files.length, "file", "files")}`;
    return { names, content: capped ? `${content} · capped` : content };
  }

  nextPickable(from, step) {
    for (let at = from; at >= 0 && at < this.rows.length; at += step) if (PICKABLE.has(this.rows[at].kind)) return at;
    return -1;
  }

  move(step) {
    const to = this.nextPickable(this.at + step, step);
    if (to < 0) return;
    this.at = to;
    this.scroll.scroll_to_item(to);
  }

  firstMatchOf(index) {
    const row = this.rows[index];
    return row?.kind === ROW_KIND.file ? this.rows[index + 1] : row;
  }

  pick(index, { vscode = false, newTab = false }) {
    const target = this.firstMatchOf(index);
    if (!target || !PICKABLE.has(target.kind) || !this.root) return;
    if (vscode) return openInVsCode(herdr, this.root, `${this.root}/${target.path}`, target.line);
    openViewer(herdr, { root: this.root, path: target.path, line: target.line, column: target.column, length: target.length }, { newTab });
  }

  flip(option, cx) {
    this.options = { ...this.options, [option]: !this.options[option] };
    this.schedule(cx);
  }

  onKey(event, cx) {
    const steps = { down: 1, up: -1 };
    const toggle = toggleFor(event);
    if (toggle) this.flip(toggle.option, cx);
    else if (event.key === "escape" && this.query) { this.input.set_value(""); this.query = ""; this.schedule(cx); }
    else if (event.key === "enter" && event.modifiers.control) this.pick(this.at, { vscode: true });
    else if (steps[event.key]) this.move(steps[event.key]);
    else return;
    cx.stop_propagation();
    cx.notify();
  }

  status() {
    if (this.error) return this.error;
    if (this.running) return "Searching…";
    if (!this.query) return "Type to find files by name and text inside them";
    if (!this.rows.length) return "Nothing found";
    return "";
  }

  results(t) {
    const onPick = (index, event, cx) => { this.at = index; this.pick(index, { vscode: event.modifiers.control, newTab: event.modifiers.shift }); cx.notify(); };
    const status = this.status();
    return v_flex().id("find-results").flex_1().min_h(0).overflow_y_scrollbar().track_scroll(this.scroll).p(6)
      .children(this.rows.map((row, index) => rowView(row, index, index === this.at, t, onPick)))
      .when(Boolean(status), (el) => el.child(div().p(8).text_size(12).text_color(t.dim).child(status)));
  }

  render(cx) {
    const t = herdr.theme();
    const now = rootKey();
    if (now !== this.rootKey) {
      const first = this.rootKey === null;
      this.rootKey = now;
      if (!first && this.query) cx.timer.after(0, (cx) => this.schedule(cx));
    }
    return v_flex().id("find").track_focus(this.handle).size_full().min_h(0).rounded(10).overflow_hidden().bg(t.background).border_1().border_color(t.border).text_color(t.foreground).text_size(13)
      .on_key_down((event, cx) => this.onKey(event, cx))
      .child(h_flex().h(42).flex_none().px(14).gap(8).items_center().border_b(1).border_color(t.border)
        .child(div().font_semibold().child("Find"))
        .child(div().flex_1().min_w(0).truncate().text_right().text_size(12).text_color(t.dim).child(this.root?.split("/").pop() ?? "")))
      .child(h_flex().h(34).flex_none().mx(8).mt(8).pl(10).pr(5).gap(6).items_center().rounded(8).border_1().border_color(t.border).bg(t.background)
        .child(Input.new(this.input).flex_1().h_full().text_size(13).text_color(t.foreground))
        .child(toggleBar({ options: this.options, t, onFlip: (option, cx) => this.flip(option, cx) })))
      .child(this.results(t));
  }
}
