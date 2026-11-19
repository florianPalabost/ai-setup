// The Viewer: a tab showing one file at the line quick open, search or find
// picked, editable, saved with ctrl-s. Each pick replaces the file, unless it has
// unsaved edits; edits on disk reload it, unless it has unsaved edits. A tab
// opened with a target in its props keeps that file and ignores picks.
import { View, div } from "gpui-kit";
import { v_flex, Editor } from "gpui-base";
import * as herdr from "herdr";
import { targetFor, fileName, CLOSE_AFTER_OPEN_MS, TABS_KEY, VIEWER_MOD } from "./target.js";
import { isBinary, lineAt, rangeFor, shown, MAX_CHARS } from "./text.js";
import { createCode } from "./code.js";
import { watchFile } from "./file-watch.js";
import { openInVsCode } from "./vscode.js";
import { viewerHeader } from "./header.js";

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

// herdr sends it when pane.go lands here.
const FOCUS = "focus";
// The picking popup still holds the keyboard until it closes, CLOSE_AFTER_OPEN_MS
// after the pick, and herdr sends no "focus" then, so take it a bit later.
const TAKE_KEYBOARD_AFTER_MS = CLOSE_AFTER_OPEN_MS + 100;

const fileOf = (target) => `${target.root}/${target.path}`;

export default class Viewer extends View {
  init(_props, cx) {
    this.seq = null; this.target = null; this.file = null; this.code = null; this.stopWatch = null;
    this.disk = null; this.text = null; this.readonly = false; this.dirty = false;
    this.error = null; this.conflict = false; this.saveError = null; this.pending = null;
    this.handle = cx.focus_handle();
    this.follow(cx);
    if (herdr.checking()) return;
    cx.spawn(async () => {
      for (;;) if ((await herdr.nextCommand()) === FOCUS) this.takeKeyboard();
    });
  }

  takeKeyboard() {
    if (this.code) this.code.focus();
    else this.handle.focus();
  }

  async close() {
    this.stopWatch?.();
  }

  space() {
    return herdr.props()?.space ?? herdr.spaces().find((space) => space.active)?.id;
  }

  claimed() {
    const claim = herdr.props()?.claim;
    const entry = herdr.shared(TABS_KEY)?.[this.space()];
    return claim && entry?.claim === claim ? entry : null;
  }

  recordTab() {
    const entry = this.claimed();
    if (!entry || entry.tab) return;
    const before = new Set(entry.before);
    const tabs = herdr.spaces().find((space) => space.id === this.space())?.tabs ?? [];
    const viewers = new Set(herdr.panes().filter((pane) => pane.mod === VIEWER_MOD).map((pane) => pane.tab));
    const added = tabs.filter((tab) => !before.has(tab.id) && viewers.has(tab.id));
    if (added.length === 1) herdr.setShared(TABS_KEY, { ...herdr.shared(TABS_KEY), [this.space()]: { ...entry, tab: added[0].id } });
  }

  // A Pinned Viewer keeps its target; otherwise only the space's Viewer tab follows picks.
  targetNow() {
    const pinned = herdr.props()?.target;
    if (pinned) return pinned;
    return this.claimed() ? targetFor(herdr, this.space()) : null;
  }

  // Loads the space's newest target; an older load still running drops its result.
  follow(cx) {
    if (!herdr.checking()) this.recordTab();
    const target = this.targetNow();
    if (!target || target.seq === this.seq) return;
    this.seq = target.seq;
    if (this.dirty && fileOf(target) !== this.file) { this.pending = target; return; }
    this.pending = null;
    if (this.dirty) { this.target = target; this.select(target, cx); return; }
    cx.spawn(async (cx) => {
      try { await this.load(target, cx); } catch { this.fail(VIEWER_ERROR_CODES.unreadable, target, cx); }
    });
  }

  async read(file) {
    let disk;
    try { disk = await herdr.readTextFile(file); } catch { return { error: VIEWER_ERROR_CODES.unreadable }; }
    if (disk === null) return { error: VIEWER_ERROR_CODES.missing };
    return isBinary(disk) ? { error: VIEWER_ERROR_CODES.binary } : { disk };
  }

  async load(target, cx) {
    const file = fileOf(target);
    const { disk, error } = await this.read(file);
    if (this.seq !== target.seq) return;
    if (error) return this.fail(error, target, cx);
    this.target = target; this.error = null;
    const tab = this.claimed()?.tab;
    if (tab) herdr.run("tab.rename", { id: tab, name: fileName(target.path) });
    this.show(file, disk, target, cx);
    cx.notify();
  }

  fail(error, target, cx) {
    if (this.seq !== target.seq) return;
    this.forget();
    this.target = target; this.error = error;
    cx.notify();
  }

  show(file, disk, target, cx) {
    const text = shown(disk);
    if (this.file !== file || !this.code) {
      this.forget();
      this.file = file;
      this.readonly = disk.length > MAX_CHARS;
      this.code = createCode(target.path, text, { readonly: this.readonly });
      this.code.on("change", (_event, cx) => this.edited(cx));
      this.stopWatch = watchFile(herdr, cx, file, (cx) => this.reload(file, cx));
    } else if (text !== this.code.value()) {
      this.code.set_value(text);
    }
    this.disk = disk; this.text = text; this.dirty = false; this.conflict = false; this.saveError = null;
    this.select(target, cx);
  }

  select(target, cx) {
    this.code.set_selected_range(rangeFor(this.code.value(), target));
    this.code.focus();
    cx.timer.after(TAKE_KEYBOARD_AFTER_MS, () => this.takeKeyboard());
  }

  edited(cx) {
    const dirty = this.code.value() !== this.text;
    if (dirty === this.dirty) return;
    this.dirty = dirty;
    cx.notify();
  }

  reload(file, cx) {
    cx.spawn(async (cx) => {
      const { disk, error } = await this.read(file);
      if (this.file !== file || !this.code || disk === this.disk) return;
      if (this.dirty) { this.conflict = true; cx.notify(); return; }
      if (error) { this.error = error; cx.notify(); return; }
      this.replace(disk);
      cx.notify();
    });
  }

  // Shows `disk` as the saved text, staying on the cursor's line.
  replace(disk) {
    const line = lineAt(this.code.value(), this.code.selected_range().start);
    const text = shown(disk);
    this.code.set_value(text);
    this.code.set_selected_range(rangeFor(text, { line }));
    this.disk = disk; this.text = text; this.dirty = false; this.conflict = false; this.saveError = null; this.error = null;
  }

  // Writes the edits unless the file changed since it was read; `overwrite`
  // writes over whatever is there now.
  async save(cx, { overwrite = false } = {}) {
    if (!this.code || this.readonly || this.error) return false;
    const file = this.file;
    const text = this.code.value();
    const expected = overwrite ? await herdr.readTextFile(file).catch(() => null) : this.disk;
    try {
      await herdr.writeTextFile(file, text, expected);
    } catch (error) {
      const now = await herdr.readTextFile(file).catch(() => null);
      if (now !== this.disk) this.conflict = true;
      else this.saveError = `${error?.message ?? error}`;
      cx.notify();
      return false;
    }
    if (this.file !== file) return true;
    this.disk = text; this.text = text; this.dirty = this.code.value() !== text;
    this.conflict = false; this.saveError = null;
    cx.notify();
    return true;
  }

  reloadFromDisk(cx) {
    cx.spawn(async (cx) => {
      const file = this.file;
      const { disk, error } = await this.read(file);
      if (this.file !== file || !this.code) return;
      if (error) { this.error = error; cx.notify(); return; }
      this.replace(disk);
      cx.notify();
    });
  }

  continueTo(cx) {
    this.pending = null; this.dirty = false;
    this.seq = null;
    this.follow(cx);
    cx.notify();
  }

  actions() {
    return {
      save: (cx) => { cx.spawn((cx) => this.save(cx)); },
      overwrite: (cx) => { cx.spawn((cx) => this.save(cx, { overwrite: true })); },
      reload: (cx) => this.reloadFromDisk(cx),
      saveAndContinue: (cx) => {
        cx.spawn(async (cx) => { if (await this.save(cx)) this.continueTo(cx); });
      },
      dropAndContinue: (cx) => this.continueTo(cx),
      openInVsCode: () => { openInVsCode(herdr, this.target.root, this.file, this.currentLine()); },
    };
  }

  forget() {
    this.stopWatch?.(); this.stopWatch = null;
    this.code?.release(); this.code = null;
    this.file = null; this.disk = null; this.text = null; this.dirty = false;
    this.conflict = false; this.saveError = null; this.readonly = false;
  }

  currentLine() {
    if (!this.code) return this.target?.line ?? 1;
    return lineAt(this.code.value(), this.code.selected_range().start);
  }

  onKey(event, cx) {
    if (event.key !== "s" || !event.modifiers.control) return;
    cx.stop_propagation();
    if (this.dirty) cx.spawn((cx) => this.save(cx));
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
    const state = {
      path: this.target?.path ?? null, dirty: this.dirty, readonly: this.readonly, error: this.error,
      conflict: this.conflict, saveError: this.saveError, pending: this.pending,
    };
    return v_flex().id("viewer").track_focus(this.handle).size_full().min_h(0).bg(t.background).text_color(t.foreground).text_size(13)
      .on_key_down((event, cx) => this.onKey(event, cx))
      .child(viewerHeader(state, this.actions(), t))
      .child(this.body(t));
  }
}
