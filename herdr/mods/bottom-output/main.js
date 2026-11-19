// The Output tab of the Bottom panel: follows one Output source of the active
// space (a factory run's watch.log, the Laravel log), remembering the pick per
// space. It stays at the end of the file until scrolled up, and stays silent on
// new lines. Another mod asks it to follow a factory ticket by setting the shared
// FOLLOW_KEY to { issue, at }.
import { View, div, svg } from "gpui-kit";
import { v_flex, h_flex, InputState, Input, Scrollbar, Select, Popup, v_virtual_list, VirtualListScrollHandle } from "gpui-base";
import * as herdr from "herdr";
import { SOURCE_KINDS, createSourceFinder, factorySourceId } from "./sources.js";
import { matching, wrapRows } from "./text.js";
import { watchFile } from "./file-watch.js";

export const FOLLOW_KEY = "bottom-output.follow";
const PICKS_KEY = "bottom-output.picks";
const HANDLED_KEY = "bottom-output.handled";
const SOURCES_REFRESH_MS = 30000;
// A space on another machine has no folder watch here, so its log is polled.
const REMOTE_POLL_MS = 3000;
const FONT_SIZE = 12;
const ROW_HEIGHT = 18;
// A monospace character's advance, as a share of the font size.
const CHAR_WIDTH = 0.6;
const ROWS_PADDING = 10;
const SCROLLBAR_WIDTH = 12;

const MESSAGES = {
  noSpace: "No space is open.",
  noSources: "No output source here: no factory ticket with a run, and no storage/logs/laravel*.log.",
  noFactoryOutput: "No output for this run. Use Log for its record.",
  noLaravelLog: "This log is no longer there.",
  unreadable: "Can't read this log.",
  noMatch: "No line matches the filter.",
  empty: "Nothing written yet.",
};

function readJson(key, fallback) {
  try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; }
}

const activeSpace = () => herdr.spaces().find((space) => space.active) ?? null;

export default class Output extends View {
  init(_props, cx) {
    this.finder = createSourceFinder({ exec: herdr.exec, readTextFile: herdr.readTextFile });
    this.spaceId = null; this.on = null; this.sources = null; this.source = null;
    this.lines = null; this.message = null; this.follow = true; this.width = 0;
    this.loading = false; this.reloadAgain = false; this.finding = 0; this.wantedIssue = null; this.unfound = null; this.stopWatch = null;
    this.picks = readJson(PICKS_KEY, {});
    this.handledAt = Number(localStorage.getItem(HANDLED_KEY) ?? 0);
    this.view = { key: null, rows: [] };
    this.scroll = VirtualListScrollHandle.new();
    this.menuOpen = false; this.menuFocus = cx.focus_handle(); this.triggerFocus = cx.focus_handle();
    this.filter = InputState.new({ placeholder: "Filter" });
    this.filter.on("change", (_event, cx) => cx.notify());
    if (herdr.checking()) return;
    cx.timer.every(SOURCES_REFRESH_MS, (cx) => this.findSources(cx));
  }

  async close() {
    this.stopWatch?.();
  }

  // Looks for the active space's sources and keeps following the one it had, else the space's pick.
  findSources(cx) {
    const space = activeSpace();
    const run = ++this.finding;
    if (!space) { this.sources = []; this.open(null, cx); return; }
    cx.spawn(async (cx) => {
      const found = await this.finder.find(space).catch(() => ({ on: null, sources: [] }));
      if (run !== this.finding) return;
      this.on = found.on;
      this.sources = found.sources;
      const issue = this.wantedIssue;
      const wanted = issue === null ? null : factorySourceId(issue);
      this.wantedIssue = null;
      const pick = [wanted, this.source?.id, this.picks[space.id]].find((id) => id && found.sources.some((source) => source.id === id));
      const source = found.sources.find((candidate) => candidate.id === pick) ?? found.sources[0] ?? null;
      if (wanted && pick === wanted) this.remember(source);
      if (wanted) this.unfound = pick === wanted ? null : `#${issue} has no run in this space's repo`;
      if (source?.id !== this.source?.id || source?.path !== this.source?.path) this.open(source, cx);
      cx.notify();
    });
  }

  remember(source) {
    if (!source || !this.spaceId) return;
    this.picks = { ...this.picks, [this.spaceId]: source.id };
    localStorage.setItem(PICKS_KEY, JSON.stringify(this.picks));
  }

  pick(source, cx) {
    this.menuOpen = false; this.unfound = null;
    this.remember(source);
    if (source.id !== this.source?.id) this.open(source, cx);
    cx.notify();
  }

  open(source, cx) {
    this.stopWatch?.();
    this.stopWatch = null;
    this.source = source; this.lines = null; this.message = null; this.follow = true;
    if (!source) return;
    this.load(cx);
    this.stopWatch = this.on
      ? ((poll) => () => poll.cancel())(cx.timer.every(REMOTE_POLL_MS, (cx) => this.load(cx)))
      : watchFile(herdr, cx, source.path, (cx) => this.load(cx));
  }

  // Reads the source's tail again; a change during a read reads once more after it.
  load(cx) {
    if (this.loading) { this.reloadAgain = true; return; }
    this.loading = true;
    const source = this.source;
    cx.spawn(async (cx) => {
      try {
        const lines = await this.finder.read(source, this.on);
        if (source !== this.source) return;
        this.lines = lines;
        this.message = lines ? null : source.kind === SOURCE_KINDS.factory ? MESSAGES.noFactoryOutput : MESSAGES.noLaravelLog;
      } catch {
        if (source === this.source) this.message = MESSAGES.unreadable;
      } finally {
        this.loading = false;
        cx.notify();
        if (this.reloadAgain) { this.reloadAgain = false; this.load(cx); }
      }
    });
  }

  // A space switch, or another mod asking for a factory ticket, looks for sources again.
  sync(cx) {
    const request = /** @type {{ issue: number, at: number } | null} */ (herdr.shared(FOLLOW_KEY));
    if (request?.at > this.handledAt) {
      this.handledAt = request.at;
      localStorage.setItem(HANDLED_KEY, String(request.at));
      this.wantedIssue = request.issue;
      this.finder.forget();
      cx.timer.after(0, (cx) => this.findSources(cx));
    }
    const space = activeSpace();
    if ((space?.id ?? null) !== this.spaceId) {
      this.spaceId = space?.id ?? null;
      this.sources = null;
      this.open(null, cx);
      cx.timer.after(0, (cx) => this.findSources(cx));
    }
  }

  // The drawn rows, worked out again only when the lines, the filter or the width change.
  rows() {
    const filter = this.filter.value();
    const columns = Math.floor((this.width - 2 * ROWS_PADDING - SCROLLBAR_WIDTH) / (FONT_SIZE * CHAR_WIDTH));
    const key = [this.lines, filter, columns];
    if (key.some((part, index) => part !== this.view.key?.[index])) {
      const count = this.view.rows.length;
      this.view = { key, rows: wrapRows(matching(this.lines ?? [], filter), columns) };
      if (this.follow && this.view.rows.length !== count) this.scroll.scroll_to_bottom();
    }
    return this.view.rows;
  }

  jumpToEnd(cx) {
    this.follow = true;
    this.scroll.scroll_to_bottom();
    cx.notify();
  }

  sourceMenu(t) {
    const sources = this.sources ?? [];
    const setOpen = (open, cx) => { this.menuOpen = open; if (open) this.menuFocus.focus(); cx.notify(); };
    const trigger = h_flex().id("output-source").track_focus(this.triggerFocus).h(26).min_w(160).max_w(360).px(8).gap(6).items_center().rounded(6)
      .border_1().border_color(t.border).bg(t.raised).text_size(12).cursor_pointer().hover((s) => s.bg(t.hover))
      .on_click((_e, cx) => setOpen(!this.menuOpen, cx))
      .child(div().flex_1().min_w(0).truncate().text_color(this.source ? t.foreground : t.dim).child(this.source?.label ?? "No source"))
      .child(svg("mods/workspace-chrome/chevron-down.svg").size(12).text_color(t.dim));
    const menu = v_flex().id("output-source-menu").w(320).max_h(300).overflow_y_scroll().p(4).gap(1).rounded(7)
      .border_1().border_color(t.border).bg(t.popover).track_focus(this.menuFocus)
      .on_key_down((e, cx) => { if (e.key === "escape") { setOpen(false, cx); cx.stop_propagation(); } })
      .children(sources.map((source) => h_flex().id(`output-option-${source.id}`).h(26).px(8).gap(6).items_center().rounded(5)
        .text_size(12).cursor_pointer().role("list_box_option").aria_selected(source.id === this.source?.id)
        .when(source.id === this.source?.id, (el) => el.bg(t.selected)).hover((s) => s.bg(t.hover))
        .on_click((_e, cx) => this.pick(source, cx))
        .child(div().flex_1().min_w(0).truncate().child(source.label))
        .when(source.running, (el) => el.child(div().flex_none().text_size(11).text_color(t.working).child("running")))));
    return Select.new("output-source-select").accessibility_label("Output source").open(this.menuOpen)
      .track_focus(this.triggerFocus).content_focus_handle(this.menuFocus)
      .on_open_change((open, cx) => setOpen(open, cx))
      .child(Popup.new("output-source-popup", trigger).anchor("bottom_left").when(this.menuOpen && sources.length > 0, (el) => el.content(menu)));
  }

  toolbar(t) {
    return h_flex().h(36).flex_none().px(8).gap(8).items_center().border_b(1).border_color(t.border)
      .child(this.sourceMenu(t))
      .child(div().w(220).h(26).px(8).flex().items_center().rounded(6).border_1().border_color(t.border)
        .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
        .child(Input.new(this.filter).h_full().text_size(12).text_color(t.foreground)))
      .child(div().flex_1().min_w(0).truncate().text_size(12).text_color(t.dim).child(this.unfound ?? ""))
      .when(!this.follow, (el) => el.child(div().id("output-end").flex_none().px(8).py(3).rounded(6).text_size(12).bg(t.raised)
        .cursor_pointer().hover((s) => s.bg(t.hover)).on_click((_e, cx) => this.jumpToEnd(cx)).child("↓ Jump to end")));
  }

  note() {
    if (!this.spaceId) return MESSAGES.noSpace;
    if (this.sources?.length === 0) return MESSAGES.noSources;
    if (this.message) return this.message;
    if (!this.lines) return null;
    if (this.lines.length === 0) return MESSAGES.empty;
    return this.view.rows.length === 0 ? MESSAGES.noMatch : null;
  }

  render(cx) {
    const t = herdr.theme();
    if (!herdr.checking()) this.sync(cx);
    const rows = this.rows();
    const note = this.note();
    return v_flex().id("output").size_full().min_h(0).bg(t.background).text_color(t.foreground).text_size(13)
      .on_size_change((size, cx) => { if (size.width !== this.width) { this.width = size.width; cx.notify(); } })
      .child(this.toolbar(t))
      .child(div().flex_1().min_h(0).relative().font_family(herdr.settings().font_family ?? "JetBrains Mono").text_size(FONT_SIZE)
        .on_scroll_wheel((e, cx) => { if (e.delta.y > 0 && this.follow) { this.follow = false; cx.notify(); } })
        .child(v_virtual_list("output-rows", rows.length, ROW_HEIGHT, (index) => String(index),
          (range) => rows.slice(range.start, range.end).map((row) => div().h(ROW_HEIGHT).px(ROWS_PADDING).whitespace_nowrap().overflow_hidden().child(row)))
          .track_scroll(this.scroll).size_full())
        .child(Scrollbar.vertical("output-rows").viewport_from_layout().absolute().inset_0())
        .when(Boolean(note), (el) => el.child(div().absolute().top(8).px(12).text_size(12).text_color(t.dim).child(note))));
  }
}
