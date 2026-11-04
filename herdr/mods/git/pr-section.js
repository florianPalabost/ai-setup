// The Pull request section: the PR of the shown space's branch.
import { div } from "gpui-kit";
import { h_flex, v_flex } from "gpui-base";
import * as herdr from "herdr";
import { openUrl } from "./links.js";
import { here, placeKey } from "./location.js";
import { PR_VIEW, loadPr } from "./pr-data.js";
import { GLYPH, checkCounts, emptyText, mergeLabel, prInterval, prSummary, reviewLabel, shownChecks, stateLabel } from "./pr-text.js";
import { refreshDue, sharedSlot, startRefresh } from "./shared-result.js";

const SLOT = "pr";
// Only decides whether something is due; the calls follow prInterval.
const TICK_MS = 15000;
const SPINNER = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

class PullRequest {
  constructor(cx) {
    this.slot = sharedSlot(SLOT);
    this.showAll = false;
    this.seen = this.slot.version;
    this.waitingOn = null;
    this.follow(cx);
    cx.timer.every(TICK_MS, (cx) => this.follow(cx));
  }

  // Runs from every panel render and timer tick, in every copy. Whichever copy
  // finds a refresh due starts it, the others wait on the same promise.
  follow(cx) {
    const { slot } = this, at = here(herdr), key = placeKey(at), now = Date.now();
    const due = refreshDue(slot, key, { active: herdr.window()?.active ?? true, now, interval: prInterval(slot.value) });
    if (due) startRefresh(slot, key, () => loadPr(herdr.exec, at, due));
    if (slot.pending && slot.pending !== this.waitingOn) {
      const pending = (this.waitingOn = slot.pending);
      cx.spawn(async (cx) => {
        await pending;
        this.redrawIfChanged(cx);
      });
    }
  }

  // Each redraw redraws the whole window, so only for a new answer.
  redrawIfChanged(cx) {
    if (this.slot.version !== this.seen) cx.notify();
  }

  header(t, pr) {
    const review = reviewLabel(pr.review), merge = mergeLabel(pr);
    return v_flex().gap(4)
      .child(h_flex().id("pr-title").gap(6).cursor_pointer().hover((s) => s.text_color(t.accent))
        .on_click(() => openUrl(pr.url))
        .child(div().flex_none().font_semibold().child(`#${pr.number}`))
        .child(div().min_w(0).truncate().child(pr.title)))
      .child(h_flex().gap(8).items_center().flex_wrap().text_size(12).text_color(t.muted)
        .child(div().font_semibold().child(stateLabel(pr)))
        .when(Boolean(review), (el) => el.child(div().child(review)))
        .when(Boolean(merge), (el) => el.child(div().child(merge))));
  }

  counts(t, checks) {
    const tones = { fail: t.ansi1, pending: t.ansi3, pass: t.ansi2, skip: t.dim };
    if (!checks.total) return div().text_size(12).text_color(t.dim).child("No checks on the last commit");
    return h_flex().gap(10).flex_wrap().text_size(12)
      .children(checkCounts(checks).map(({ bucket, text }) => h_flex().gap(4).text_color(checks[bucket] ? tones[bucket] : t.dim)
        .child(GLYPH[bucket]).child(text)))
      .when(checks.truncated, (el) => el.child(div().text_color(t.dim).child(`first ${checks.list.length} of ${checks.total}`)));
  }

  row(t, check, index) {
    const tones = { fail: t.ansi1, pending: t.ansi3, pass: t.ansi2, skip: t.dim };
    return h_flex().id(`pr-check-${index}`).gap(6).px(4).py(2).rounded(4).items_center().text_size(12)
      .when(Boolean(check.url), (el) => el.cursor_pointer().hover((s) => s.bg(t.hover)).on_click(() => openUrl(check.url)))
      .child(div().w(14).flex_none().text_color(tones[check.bucket])
        .when(check.bucket === "pending", (el) => el.frames(SPINNER, 90))
        .when(check.bucket !== "pending", (el) => el.child(GLYPH[check.bucket])))
      .child(div().flex_1().min_w(0).truncate().text_color(check.bucket === "fail" ? t.foreground : t.muted).child(check.name));
  }

  checks(t, checks) {
    const { shown, hidden } = shownChecks(checks.list, this.showAll);
    return v_flex().gap(1)
      .children(shown.map((check, index) => this.row(t, check, index)))
      .when(hidden > 0 || this.showAll, (el) => el.child(div().id("pr-toggle-passing").px(4).py(2).text_size(11).text_color(t.accent).cursor_pointer()
        .on_click((_e, cx) => { this.showAll = !this.showAll; cx.notify(); })
        .child(this.showAll ? "Hide passing and skipped" : `Show ${hidden} passing / skipped`)));
  }

  empty(t, view) {
    const box = v_flex().p(10).gap(8).text_size(12).text_color(t.muted).child(emptyText(view));
    if (view?.kind !== PR_VIEW.NO_PR) return box;
    return box.child(h_flex().child(div().id("pr-create").px(8).py(3).rounded(5).border(1).border_color(t.border).cursor_pointer()
      .hover((s) => s.bg(t.hover).text_color(t.foreground)).on_click(() => openUrl(view.compareUrl)).child("Create PR ↗")));
  }

  render() {
    const t = herdr.theme(), view = this.slot.value;
    this.seen = this.slot.version;
    if (view?.kind !== PR_VIEW.PR) return this.empty(t, view);
    return v_flex().p(10).gap(8).child(this.header(t, view.pr)).child(this.counts(t, view.pr.checks)).child(this.checks(t, view.pr.checks));
  }
}

export const pullRequest = {
  id: "pr",
  label: "Pull request",
  defaultOpen: true,
  fill: false,
  create(_props, cx) {
    const part = new PullRequest(cx);
    return {
      sync: (cx) => part.follow(cx),
      summary: () => prSummary(part.slot.value),
      render: () => part.render(),
    };
  },
};
