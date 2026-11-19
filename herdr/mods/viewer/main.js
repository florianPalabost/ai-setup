// The Viewer: a tab showing one file read-only, at the line quick open or
// search picked. Each pick replaces the file; agent edits reload it in place.
import { View, div } from "gpui-kit";
import { v_flex, h_flex, Editor } from "gpui-base";
import * as herdr from "herdr";
import { targetFor } from "./target.js";
import { isBinary, lineAt, rangeFor, shown } from "./text.js";
import { createCode } from "./code.js";
import { watchFile } from "./file-watch.js";
import { openInVsCode } from "./vscode.js";

export const VIEWER_ERROR_CODES = Object.freeze({
  missing: "viewer_file_missing",
  binary: "viewer_file_binary",
  unreadable: "viewer_file_unreadable",
});

const MESSAGES = {
  [VIEWER_ERROR_CODES.missing]: "This file is no longer there",
  [VIEWER_ERROR_CODES.binary]: "Binary file · no text preview",
  [VIEWER_ERROR_CODES.unreadable]: "Cannot read this file (too large or unreadable)",
};

const fileOf = (target) => `${target.root}/${target.path}`;

export default class Viewer extends View {
  init(_props, cx) {
    this.seq = null; this.target = null; this.file = null; this.text = null;
    this.code = null; this.error = null; this.stopWatch = null;
    this.follow(cx);
  }

  // Loads the space's newest target; an older load still running drops its result.
  follow(cx) {
    const target = targetFor(herdr, this.space());
    if (!target || target.seq === this.seq) return;
    this.seq = target.seq;
    cx.spawn(async (cx) => {
      try { await this.load(target, cx); } catch { this.fail(VIEWER_ERROR_CODES.unreadable, target, cx); }
    });
  }

  async close() {
    this.stopWatch?.();
  }

  space() {
    return herdr.props()?.space ?? herdr.spaces().find((space) => space.active)?.id;
  }

  async read(file) {
    let text;
    try { text = await herdr.readTextFile(file); } catch { return { error: VIEWER_ERROR_CODES.unreadable }; }
    if (text === null) return { error: VIEWER_ERROR_CODES.missing };
    return isBinary(text) ? { error: VIEWER_ERROR_CODES.binary } : { text: shown(text) };
  }

  async load(target, cx) {
    const file = fileOf(target);
    const { text, error } = await this.read(file);
    if (this.seq !== target.seq) return;
    if (error) return this.fail(error, target, cx);
    this.target = target; this.error = null;
    this.show(file, text, target, cx);
    cx.notify();
  }

  fail(error, target, cx) {
    if (this.seq !== target.seq) return;
    this.forget();
    this.target = target; this.error = error;
    cx.notify();
  }

  show(file, text, target, cx) {
    if (this.file !== file || !this.code) {
      this.forget();
      this.file = file;
      this.code = createCode(target.path, text);
      this.stopWatch = watchFile(herdr, cx, file, (cx) => this.reload(file, cx));
    } else if (text !== this.text) {
      this.code.set_value(text);
    }
    this.text = text;
    this.code.set_selected_range(rangeFor(text, target));
    this.code.focus();
  }

  reload(file, cx) {
    cx.spawn(async (cx) => {
      const { text, error } = await this.read(file);
      if (this.file !== file || !this.code || text === this.text) return;
      if (error) { this.error = error; cx.notify(); return; }
      const line = lineAt(this.text, this.code.selected_range().start);
      this.code.set_value(text);
      this.code.set_selected_range(rangeFor(text, { line }));
      this.text = text; this.error = null;
      cx.notify();
    });
  }

  forget() {
    this.stopWatch?.(); this.stopWatch = null;
    this.code?.release(); this.code = null;
    this.file = null; this.text = null;
  }

  currentLine() {
    if (!this.code || this.text === null) return this.target?.line ?? 1;
    return lineAt(this.text, this.code.selected_range().start);
  }

  header(t) {
    const target = this.target;
    return h_flex().h(36).flex_none().px(12).gap(10).items_center().border_b(1).border_color(t.border)
      .child(div().flex_1().min_w(0).truncate().text_color(target ? t.foreground : t.dim).child(target?.path ?? "Viewer"))
      .when(Boolean(target) && !this.error, (el) => el.child(
        div().id("viewer-vscode").flex_none().px(8).py(3).rounded(6).text_size(12).cursor_pointer()
          .bg(t.raised).hover((s) => s.bg(t.hover))
          .on_click(() => { openInVsCode(herdr, fileOf(target), this.currentLine()); })
          .child("Open in VS Code")));
  }

  body(t) {
    if (this.error) return div().p(12).text_color(t.dim).child(MESSAGES[this.error]);
    if (this.code) return Editor.new(this.code).flex_1().min_h(0);
    const waiting = this.seq !== null;
    return div().p(12).text_color(t.dim).child(waiting ? "Loading file…" : "Nothing to show yet: pick a file with quick open or search");
  }

  render(cx) {
    this.follow(cx);
    const t = herdr.theme();
    return v_flex().id("viewer").size_full().min_h(0).bg(t.background).text_color(t.foreground).text_size(13)
      .child(this.header(t))
      .child(this.body(t));
  }
}
