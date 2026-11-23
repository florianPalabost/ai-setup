import { View, div } from "gpui-kit";
import { v_flex, h_flex, InputState, Input, Editor } from "gpui-base";
import * as herdr from "herdr";
import { findRoot } from "./root.js";
import { listFiles } from "./files.js";
import { rank } from "./fuzzy.js";
import { recentFiles, rememberFile, recentFirst } from "./recent.js";
import { Preview, PREVIEW_MESSAGES } from "./preview.js";
import { resultList, scrollTop, ROW_HEIGHT } from "./list.js";
import { openViewer, CLOSE_AFTER_OPEN_MS } from "./target.js";
import { openInVsCode } from "./vscode.js";

const LIMIT = 500;
const WHEEL_ROWS = 3;
const FIRST_LINE = 1;
// The popup is as tall as its content, so the list and preview get a height.
const BODY_HEIGHT = 520;

export default class QuickOpen extends View {
  init(_props, cx) {
    this.query = ""; this.hits = []; this.at = 0; this.top = 0; this.visible = 1;
    this.root = null; this.paths = null; this.error = null; this.leaving = false;
    this.space = herdr.spaces().find((space) => space.active)?.id ?? null;
    this.preview = new Preview();
    this.handle = cx.focus_handle();
    this.input = InputState.new({ placeholder: "Go to file…" });
    this.input.on("change", (_event, cx) => { this.query = this.input.value(); this.refilter(); cx.notify(); });
    this.input.on("submit", (event, cx) => this.pick(this.at, { vscode: event.secondary, newTab: event.shift }, cx));
    this.input.focus();
    if (herdr.checking()) return;
    cx.spawn(async (cx) => {
      try {
        this.root = await findRoot(herdr);
        this.paths = this.root ? await listFiles(herdr.exec, this.root) : [];
      } catch (error) {
        this.error = `${error?.message ?? error}${error?.code ? ` (${error.code})` : ""}`;
        this.paths = [];
      }
      this.refilter();
      cx.notify();
    });
  }

  async close() {
    this.preview.release();
  }

  refilter() {
    this.at = 0; this.top = 0;
    if (!this.paths) { this.hits = []; return; }
    if (this.query.trim()) { this.hits = rank(this.query, this.paths, LIMIT); return; }
    const ordered = recentFirst(recentFiles(herdr, this.space), this.root, this.paths);
    this.hits = ordered.slice(0, LIMIT).map((path) => ({ path }));
  }

  move(by) {
    if (!this.hits.length) return;
    this.at = Math.max(0, Math.min(this.hits.length - 1, this.at + by));
  }

  pick(index, { vscode = false, newTab = false }, cx) {
    const hit = this.hits[index];
    if (!hit || this.leaving) return;
    const file = `${this.root}/${hit.path}`;
    if (this.space) rememberFile(herdr, this.space, file);
    if (vscode) {
      openInVsCode(herdr, this.root, file, FIRST_LINE);
      return this.dismiss();
    }
    openViewer(herdr, { root: this.root, path: hit.path, line: FIRST_LINE }, { newTab });
    this.leaving = true;
    cx.timer.after(CLOSE_AFTER_OPEN_MS, () => this.dismiss());
  }

  dismiss() {
    herdr.closeOverlay(herdr.props().overlay);
  }

  onKey(event, cx) {
    const page = Math.max(1, this.visible - 1);
    const steps = { down: 1, up: -1, pagedown: page, pageup: -page };
    if (event.key === "escape") return this.dismiss();
    if (event.key === "enter" && event.modifiers.control) this.pick(this.at, { vscode: true }, cx);
    else if (steps[event.key]) this.move(steps[event.key]);
    else return;
    cx.stop_propagation();
    cx.notify();
  }

  onWheel(event, cx) {
    const rows = Math.sign(event.delta.y) * -WHEEL_ROWS;
    const last = Math.max(0, this.hits.length - this.visible);
    this.top = Math.max(0, Math.min(last, this.top + rows));
    this.at = Math.max(this.top, Math.min(this.top + this.visible - 1, this.at));
    cx.notify();
  }

  status() {
    if (this.error) return this.error;
    if (!this.paths) return "Listing files…";
    if (!this.root) return "No folder here";
    if (!this.hits.length) return "No matching file";
    return `${this.hits.length}${this.hits.length === LIMIT ? "+" : ""} of ${this.paths.length} files`;
  }

  previewPane(t) {
    const body = this.preview.code
      ? Editor.new(this.preview.code).flex_1().min_h(0)
      : div().p(12).text_color(t.dim).child(this.preview.error ? PREVIEW_MESSAGES[this.preview.error] : "");
    return v_flex().flex_1().h_full().min_w(0).min_h(0).rounded(8).overflow_hidden().border_1().border_color(t.border).bg(t.background).child(body);
  }

  listPane(t) {
    this.top = scrollTop(this.top, this.at, this.visible, this.hits.length);
    return v_flex().id("qo-list").w_2_5().h_full().flex_none().min_h(0).overflow_hidden()
      .on_size_change((size, cx) => { this.visible = Math.max(1, Math.floor(size.height / herdr.settings().zoom / ROW_HEIGHT)); cx.notify(); })
      .on_scroll_wheel((event, cx) => this.onWheel(event, cx))
      .child(resultList({ hits: this.hits, at: this.at, top: this.top, visible: this.visible, t, onPick: (index, event, cx) => { this.at = index; this.pick(index, { vscode: event.modifiers.control, newTab: event.modifiers.shift }, cx); } }));
  }

  render(cx) {
    const t = herdr.theme();
    const hit = this.hits[this.at];
    this.preview.show(this.root, hit ? { path: hit.path, line: FIRST_LINE } : null, cx);
    return v_flex().id("quick-open").track_focus(this.handle).w_full().p(14).gap(10).bg(t.popover).text_size(13).text_color(t.foreground)
      .on_key_down((event, cx) => this.onKey(event, cx))
      .child(h_flex().h(36).flex_none().px(10).items_center().rounded(8).border_1().border_color(t.accent).bg(t.background)
        .child(Input.new(this.input).flex_1().h_full().text_size(13).text_color(t.foreground)))
      .child(h_flex().h(BODY_HEIGHT).flex_none().gap(12).child(this.listPane(t)).child(this.previewPane(t)))
      .child(h_flex().flex_none().gap(16).text_size(11).text_color(t.dim)
        .child(div().flex_1().min_w(0).truncate().child(this.status()))
        .child(div().child("Enter: Viewer · Shift+Enter: new tab · Ctrl+Enter: VS Code · Esc: close")));
  }
}
