import { View, div } from "gpui-kit";
import { h_flex } from "gpui-base";
import { home, readTextFile, theme } from "herdr";
import { meterParts } from "./meter.js";

const CACHE_PATH = ".cache/claude-usage/limits.json";
const REFRESH_MS = 30000;
const TONE_COLOR = { low: "ansi2", mid: "ansi3", high: "ansi1" };

async function readSaved() {
  try {
    return JSON.parse((await readTextFile(`${home()}/${CACHE_PATH}`)) ?? "null");
  } catch {
    return null;
  }
}

export default class UsageMeter extends View {
  init(_props, cx) {
    this.saved = null;
    cx.spawn(async (cx) => {
      for (;;) {
        this.saved = await readSaved();
        cx.notify();
        await cx.sleep(REFRESH_MS);
      }
    });
  }

  render() {
    const t = theme();
    const parts = meterParts(this.saved, Date.now() / 1000);
    const limit = (part) => h_flex().gap(5).items_center()
      .child(part.label)
      .child(div().text_color(t[TONE_COLOR[part.tone]]).child(part.percent))
      .when(Boolean(part.resets), (el) => el.child(div().text_color(t.dim).child(part.resets)));
    const row = h_flex().size_full().pr(14).gap(8).items_center().justify_end().bg(t.chrome).border_t(1).border_color(t.border).text_size(11.8).text_color(t.muted);
    parts.forEach((part, index) => {
      if (index > 0) row.child(div().text_color(t.dim).child("·"));
      row.child(limit(part));
    });
    return row;
  }
}
