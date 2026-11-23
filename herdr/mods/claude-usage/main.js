import { View, div } from "gpui-kit";
import { h_flex, Popover } from "gpui-base";
import { home, readTextFile, theme } from "herdr";
import { SHOW_LEFT, SHOW_USED, limitBars, meterParts, toneColor } from "./meter.js";
import { barsPanel } from "./bars.js";

const CACHE_PATH = ".cache/claude-usage/limits.json";
const SHOW_KEY = "claude-usage.show";
const REFRESH_MS = 30000;

async function readSaved() {
  try {
    return JSON.parse((await readTextFile(`${home()}/${CACHE_PATH}`)) ?? "null");
  } catch {
    return null;
  }
}

function readShow() {
  try {
    return localStorage.getItem(SHOW_KEY) === SHOW_LEFT ? SHOW_LEFT : SHOW_USED;
  } catch {
    return SHOW_USED;
  }
}

export default class UsageMeter extends View {
  init(_props, cx) {
    this.saved = null;
    this.open = false;
    this.show = readShow();
    cx.spawn(async (cx) => {
      for (;;) {
        this.saved = await readSaved();
        cx.notify();
        await cx.sleep(REFRESH_MS);
      }
    });
  }

  setShow(show, cx) {
    this.show = show;
    try { localStorage.setItem(SHOW_KEY, show); } catch {}
    cx.notify();
  }

  meter(t, parts) {
    const limit = (part) => h_flex().gap(5).items_center()
      .child(part.label)
      .child(div().text_color(toneColor(t, part.tone)).child(part.percent))
      .when(Boolean(part.resets), (el) => el.child(div().text_color(t.dim).child(part.resets)));
    const row = h_flex().id("meter").h_full().gap(8).items_center().cursor_pointer();
    parts.forEach((part, index) => {
      if (index > 0) row.child(div().text_color(t.dim).child("·"));
      row.child(limit(part));
    });
    return row;
  }

  render() {
    const t = theme();
    const now = Date.now() / 1000;
    const parts = meterParts(this.saved, now);
    const bar = h_flex().size_full().pr(14).items_center().justify_end()
      .bg(t.chrome).border_t(1).border_color(t.border).text_size(11.8).text_color(t.muted);
    if (!parts.length) return bar;
    const bars = limitBars(this.saved, now, this.show);
    return bar.child(Popover.new("usage").anchor("bottom_right").open(this.open)
      .on_open_change((open, cx) => { this.open = open; cx.notify(); })
      .trigger(this.meter(t, parts))
      .content(barsPanel(t, bars, this.show, (show, cx) => this.setShow(show, cx))));
  }
}
