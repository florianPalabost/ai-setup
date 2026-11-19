import { View, div } from "gpui-kit";
import { v_flex, h_flex, InputState, Input, Editor } from "gpui-base";
import * as herdr from "herdr";
import { findRoot } from "./root.js";
import { search, MATCH_LIMIT } from "./rg.js";
import { Preview, PREVIEW_MESSAGES } from "./preview.js";
import { resultList, rowsFor, scrollTop, ROW_HEIGHT, ROW_KIND } from "./list.js";
import { toggleBar, toggleFor } from "./toggles.js";
import { openViewer, CLOSE_AFTER_OPEN_MS } from "./target.js";
import { openInVsCode } from "./vscode.js";

const TYPING_PAUSE_MS = 200;
const WHEEL_ROWS = 3;
// Popups size to their content, so the list and preview get a fixed height.
const BODY_HEIGHT = 520;

const plural = (count, word) => `${count.toLocaleString("en")} ${word}${count === 1 ? "" : "es"}`;
const describe = (error) => `${error?.message ?? error}${error?.code ? ` (${error.code})` : ""}`;

export default class Search extends View {
  init(_props, cx) {
    this.query = ""; this.options = { regex: false, wholeWord: false };
    this.rows = []; this.found = null; this.at = 0; this.top = 0; this.visible = 1;
    this.root = undefined; this.error = null; this.running = false; this.leaving = false;
    this.latestRun = 0; this.pending = null;
    this.preview = new Preview();
    this.handle = cx.focus_handle();
    this.input = InputState.new({ placeholder: "Search in files…" });
    this.input.on("change", (_event, cx) => { this.query = this.input.value(); this.schedule(cx); });
    this.input.on("submit", (event, cx) => this.pick(this.at, { vscode: event.secondary, newTab: event.shift }, cx));
    this.input.focus();
    if (herdr.checking()) return;
    cx.spawn(async (cx) => {
      try {
        this.root = await findRoot(herdr);
      } catch (error) {
        this.root = null;
        this.error = describe(error);
      }
      this.schedule(cx);
      cx.notify();
    });
  }

  async close() {
    this.pending?.cancel();
    this.preview.release();
  }

  schedule(cx) {
    this.pending?.cancel();
    this.latestRun++;
    this.running = true;
    this.pending = cx.timer.after(TYPING_PAUSE_MS, (cx) => this.run(cx));
    cx.notify();
  }

  run(cx) {
    const run = this.latestRun;
    const query = this.query;
    if (!this.root) { this.running = false; return cx.notify(); }
    if (!query) return this.show(null, null, cx);
    cx.spawn(async (cx) => {
      let found = null;
      let error = null;
      try {
        found = await search(herdr.exec, this.root, query, this.options);
      } catch (caught) {
        error = describe(caught);
      }
      if (run === this.latestRun) this.show(found, error, cx);
    });
  }

  show(found, error, cx) {
    this.running = false;
    this.found = found;
    this.error = error;
    this.rows = found ? rowsFor(found.files) : [];
    this.top = 0;
    this.at = this.nearestMatch(0, 1);
    this.preview.release();
    this.follow(cx);
    cx.notify();
  }

  nearestMatch(index, step) {
    for (let at = index; at >= 0 && at < this.rows.length; at += step) if (this.rows[at].kind === ROW_KIND.match) return at;
    for (let at = index; at >= 0 && at < this.rows.length; at -= step) if (this.rows[at].kind === ROW_KIND.match) return at;
    return 0;
  }

  move(by) {
    if (!this.rows.length) return;
    const to = Math.max(0, Math.min(this.rows.length - 1, this.at + by));
    this.at = this.nearestMatch(to, Math.sign(by));
  }

  // Not from render: a selection set there does not move the editor.
  follow(cx) {
    const match = this.firstMatchOf(this.at);
    this.preview.show(match ? `${this.root}/${match.path}` : null, match ?? null, cx);
  }

  firstMatchOf(index) {
    const row = this.rows[index];
    return row?.kind === ROW_KIND.file ? this.rows[index + 1] : row;
  }

  pick(index, { vscode = false, newTab = false }, cx) {
    const match = this.firstMatchOf(index);
    if (!match || this.leaving) return;
    if (vscode) {
      openInVsCode(herdr, this.root, `${this.root}/${match.path}`, match.line);
      return this.dismiss();
    }
    openViewer(herdr, { root: this.root, path: match.path, line: match.line, column: match.column, length: match.length }, { newTab });
    this.leaving = true;
    cx.timer.after(CLOSE_AFTER_OPEN_MS, () => this.dismiss());
  }

  dismiss() {
    herdr.closeOverlay(herdr.props().overlay);
  }

  flip(option, cx) {
    this.options = { ...this.options, [option]: !this.options[option] };
    this.schedule(cx);
  }

  onKey(event, cx) {
    const page = Math.max(1, this.visible - 1);
    const steps = { down: 1, up: -1, pagedown: page, pageup: -page };
    const toggle = toggleFor(event);
    if (event.key === "escape") return this.dismiss();
    if (toggle) this.flip(toggle.option, cx);
    else if (event.key === "enter" && event.modifiers.control) this.pick(this.at, { vscode: true }, cx);
    else if (steps[event.key]) { this.move(steps[event.key]); this.follow(cx); }
    else return;
    cx.stop_propagation();
    cx.notify();
  }

  onWheel(event, cx) {
    const rows = Math.sign(event.delta.y) * -WHEEL_ROWS;
    const last = Math.max(0, this.rows.length - this.visible);
    this.top = Math.max(0, Math.min(last, this.top + rows));
    this.at = this.nearestMatch(Math.max(this.top, Math.min(this.top + this.visible - 1, this.at)), 1);
    this.follow(cx);
    cx.notify();
  }

  status() {
    if (this.error) return this.error;
    if (this.root === undefined) return "Finding the folder…";
    if (!this.root) return "No folder here";
    if (!this.query) return `Search in ${this.root}`;
    if (this.running || !this.found) return "Searching…";
    const { count, files, capped } = this.found;
    if (!count) return "No results";
    const summary = `${plural(count, "match")} in ${files.length} file${files.length === 1 ? "" : "s"}`;
    return capped ? `${summary} · results capped at ${MATCH_LIMIT.toLocaleString("en")}` : summary;
  }

  previewPane(t) {
    const body = this.preview.code
      ? Editor.new(this.preview.code).flex_1().min_h(0)
      : div().p(12).text_color(t.dim).child(this.preview.error ? PREVIEW_MESSAGES[this.preview.error] : "");
    return v_flex().flex_1().h_full().min_w(0).min_h(0).rounded(8).overflow_hidden().border_1().border_color(t.border).bg(t.background).child(body);
  }

  listPane(t) {
    this.top = scrollTop(this.top, this.at, this.visible, this.rows.length);
    return v_flex().id("search-list").w_2_5().h_full().flex_none().min_h(0).overflow_hidden()
      .on_size_change((size, cx) => { this.visible = Math.max(1, Math.floor(size.height / herdr.settings().zoom / ROW_HEIGHT)); cx.notify(); })
      .on_scroll_wheel((event, cx) => this.onWheel(event, cx))
      .child(resultList({ rows: this.rows, at: this.at, top: this.top, visible: this.visible, t, onPick: (index, event, cx) => { this.at = index; this.pick(index, { vscode: event.modifiers.control, newTab: event.modifiers.shift }, cx); } }));
  }

  render(cx) {
    const t = herdr.theme();
    return v_flex().id("search").track_focus(this.handle).w_full().p(14).gap(10).bg(t.popover).text_size(13).text_color(t.foreground)
      .on_key_down((event, cx) => this.onKey(event, cx))
      .child(h_flex().h(36).flex_none().pl(10).pr(6).gap(8).items_center().rounded(8).border_1().border_color(t.accent).bg(t.background)
        .child(Input.new(this.input).flex_1().h_full().text_size(13).text_color(t.foreground))
        .child(toggleBar({ options: this.options, t, onFlip: (option, cx) => this.flip(option, cx) })))
      .child(h_flex().h(BODY_HEIGHT).flex_none().gap(12).child(this.listPane(t)).child(this.previewPane(t)))
      .child(h_flex().flex_none().gap(16).text_size(11).text_color(t.dim)
        .child(div().flex_1().min_w(0).truncate().child(this.status()))
        .child(div().child("Enter: Viewer · Shift+Enter: new tab · Ctrl+Enter: VS Code · Alt+R: regex · Alt+W: whole word · Esc: close")));
  }
}
