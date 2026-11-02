// PROTOTYPE (wayfinder #6), placement 2: a small pane/popup with the detail.
// Open as a pane (pane.split) or tab (tab.new); proto-pr-strip also opens it as
// a popup from its checks counts (props.from === "strip").
//
// Click the title or "Open on GitHub": opens the PR. Click a check: opens its
// details page (the Actions run / status target). ↻: refresh now (no gh cache).

import { View, div } from "gpui-kit";
import { h_flex, v_flex } from "gpui-base";
import { theme, props, closeOverlay } from "herdr";
import { PrWatcher, openUrl, tones, GLYPH, SPIN, stateLabel, reviewLabel, emptyText, ago } from "./pr-data.js";

const MERGE = { CLEAN: "Ready to merge", BLOCKED: "Blocked", BEHIND: "Behind base", DIRTY: "Conflicts", UNSTABLE: "Unstable (non-required checks failing)", HAS_HOOKS: "Ready (hooks)", DRAFT: "Draft", UNKNOWN: "Merge state unknown" };
const SECTION = { fail: "Failing", pending: "Pending", pass: "Passing", skip: "Skipped" };

export class PrPane {
  init(_props, cx) {
    this.w = new PrWatcher();
    this.showPassing = false;
    this.w.start(cx);
  }

  button(t, id, text, onClick) {
    return div().id(id).flex_none().px(8).py(3).rounded(5).border(1).border_color(t.border).cursor_pointer()
      .text_size(12).text_color(t.muted).hover((s) => s.bg(t.hover).text_color(t.foreground)).on_click(onClick).child(text);
  }

  header(t, s) {
    const tone = tones(t), pr = s.pr, [label, key] = stateLabel(pr), review = reviewLabel(pr.review);
    return v_flex().gap(6).pb(10).border_b(1).border_color(t.border)
      .child(div().text_size(11).text_color(t.dim).child(`${s.repo} · ${s.branch}`))
      .child(h_flex().id("title").gap(6).cursor_pointer().hover((x) => x.text_color(t.accent))
        .on_click(() => openUrl(pr.url))
        .child(div().flex_none().font_semibold().child(`#${pr.number}`))
        .child(div().min_w(0).truncate().child(pr.title)))
      .child(h_flex().gap(8).items_center().text_size(12)
        .child(div().px(6).py(1).rounded(4).border(1).border_color(tone[key]).text_color(tone[key]).child(label))
        .child(div().text_color(review ? tone[review[1]] : t.dim).child(review ? review[0] : "No review rules"))
        .when(Boolean(pr.merge) && pr.state === "OPEN", (el) => el.child(div().text_color(pr.merge === "CLEAN" ? tone.pass : t.muted).child(`· ${MERGE[pr.merge] ?? pr.merge}`))));
  }

  summary(t, c) {
    const tone = tones(t);
    if (!c.total) return div().text_size(12).text_color(t.dim).child("No checks on the last commit");
    const n = (b) => h_flex().gap(4).text_color(c[b] ? tone[b] : t.dim).child(GLYPH[b]).child(`${c[b]} ${SECTION[b].toLowerCase()}`);
    return h_flex().gap(14).text_size(12).child(n("fail")).child(n("pending")).child(n("pass")).child(n("skip"))
      .when(c.truncated, (el) => el.child(div().text_color(t.dim).child(`(first ${c.list.length} of ${c.total})`)));
  }

  row(t, c, i) {
    const tone = tones(t);
    return h_flex().id(`check-${i}`).gap(8).px(6).py(3).rounded(4).items_center().text_size(12)
      .when(Boolean(c.url), (el) => el.cursor_pointer().hover((s) => s.bg(t.hover)).on_click(() => openUrl(c.url)))
      .child(div().w(14).flex_none().text_color(tone[c.bucket])
        .when(c.bucket === "pending", (el) => el.frames(SPIN, 90))
        .when(c.bucket !== "pending", (el) => el.child(GLYPH[c.bucket])))
      .child(div().flex_1().min_w(0).truncate().text_color(c.bucket === "fail" ? t.foreground : t.muted).child(c.name))
      .when(Boolean(c.workflow), (el) => el.child(div().flex_none().max_w(160).truncate().text_color(t.dim).child(c.workflow)))
      .child(div().flex_none().text_size(10).text_color(t.dim).child(c.raw.toLowerCase()));
  }

  list(t, c, cx) {
    const shown = c.list.filter((x) => this.showPassing || x.bucket === "fail" || x.bucket === "pending");
    const hidden = c.list.length - shown.length;
    return v_flex().id("checks").flex_1().min_h(0).overflow_y_scrollbar().gap(1)
      .children(shown.map((x, i) => this.row(t, x, i)))
      .when(hidden > 0 || this.showPassing, (el) => el.child(div().id("toggle-passing").px(6).py(4).text_size(11).text_color(t.accent).cursor_pointer()
        .on_click((_e, cx) => { this.showPassing = !this.showPassing; cx.notify(); })
        .child(this.showPassing ? "Hide passing and skipped" : `Show ${hidden} passing / skipped`)));
  }

  footer(t) {
    const s = this.w.state;
    return h_flex().gap(8).pt(8).border_t(1).border_color(t.border).items_center().text_size(11).text_color(t.dim)
      .child(div().flex_1().min_w(0).truncate().child(`checked ${ago(this.w.at)} (${this.w.reason ?? "–"})${s.meta ? ` · gh ${s.meta.ms} ms, cost ${s.meta.cost}, ${s.meta.remaining} left` : ""}`))
      .child(div().id("refresh").flex_none().px(6).rounded(4).cursor_pointer().hover((x) => x.bg(t.hover))
        .on_click((_e, cx) => this.w.refresh(cx, "manual"))
        .when(this.w.loading, (el) => el.frames(SPIN, 90))
        .when(!this.w.loading, (el) => el.child("↻ refresh")));
  }

  render(cx) {
    const t = theme(), s = this.w.state, overlay = props()?.overlay;
    const root = v_flex().size_full().p(14).gap(10).bg(t.surface).text_color(t.foreground);
    if (s.kind !== "pr") {
      return root
        .child(div().text_size(11).text_color(t.dim).child("PROTOTYPE proto-pr-pane"))
        .child(div().flex_1().text_size(13).text_color(s.kind === "error" ? tones(t).fail : t.muted)
          .when(Boolean(s.repo), (el) => el.child(div().text_size(11).text_color(t.dim).child(`${s.repo} · ${s.branch}`)))
          .child(emptyText(s)))
        .when(s.kind === "no-pr", (el) => el.child(h_flex().child(this.button(t, "create", "Create PR on GitHub ↗", () => openUrl(s.compareUrl)))))
        .child(this.footer(t));
    }
    const pr = s.pr;
    return root
      .child(this.header(t, s))
      .child(this.summary(t, pr.checks))
      .child(this.list(t, pr.checks, cx))
      .child(h_flex().gap(8)
        .child(this.button(t, "open", "Open on GitHub ↗", () => openUrl(pr.url)))
        .child(this.button(t, "open-checks", "Checks tab ↗", () => openUrl(`${pr.url}/checks`)))
        .when(Boolean(overlay), (el) => el.child(this.button(t, "close", "Close", () => closeOverlay(overlay)))))
      .child(this.footer(t));
  }
}
