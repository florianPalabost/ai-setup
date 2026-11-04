// The My PRs & reviews section: what's waiting on me across all of github.com.
import { div } from "gpui-kit";
import { h_flex, v_flex } from "gpui-base";
import { exec, theme, window } from "herdr";
import { openUrl } from "./links.js";
import { PRS_VIEW, loadMyPrs } from "./prs-data.js";
import { PRS_INTERVAL_MS, ago, checksMark, listNote, prsEmptyText, prsSummary, reviewWord } from "./prs-text.js";
import { refreshDue, sharedSlot, startRefresh } from "./shared-result.js";

const SLOT = "prs";
// The list isn't tied to a space or branch, so there is one view.
const VIEW_KEY = "mine";
// Only decides whether something is due; the calls follow PRS_INTERVAL_MS.
const TICK_MS = 15000;

class MyPrs {
  constructor(cx) {
    this.slot = sharedSlot(SLOT);
    this.seen = this.slot.version;
    this.waitingOn = null;
    this.shownEmptyText = null;
    this.follow(cx);
    cx.timer.every(TICK_MS, (cx) => {
      this.follow(cx);
      this.keepEmptyTextTrue(cx);
    });
  }

  // Runs from every panel render and timer tick, in every copy, open or collapsed,
  // since the collapsed header needs the count too.
  follow(cx) {
    const { slot } = this;
    const due = refreshDue(slot, VIEW_KEY, { active: window()?.active ?? true, now: Date.now(), interval: PRS_INTERVAL_MS });
    if (due) startRefresh(slot, VIEW_KEY, () => loadMyPrs(exec, due));
    if (slot.pending && slot.pending !== this.waitingOn) {
      const pending = (this.waitingOn = slot.pending);
      cx.spawn(async (cx) => {
        await pending;
        if (this.slot.version !== this.seen) cx.notify();
      });
    }
  }

  // "just now" would otherwise stay up with the window idle: an unchanged answer
  // doesn't redraw. Cleared here and set in render, so a collapsed section stops asking.
  keepEmptyTextTrue(cx) {
    if (this.shownEmptyText === null) return;
    if (this.shownEmptyText === prsEmptyText(this.slot.value, this.slot.at, Date.now())) return;
    this.shownEmptyText = null;
    cx.notify();
  }

  row(t, pr, id, showAuthor, now) {
    const tones = { pass: t.ansi2, fail: t.ansi1, pending: t.ansi3, none: t.dim };
    const reviewTones = { APPROVED: t.ansi2, CHANGES_REQUESTED: t.ansi1, REVIEW_REQUIRED: t.muted };
    const mark = checksMark(pr.checks), review = reviewWord(pr.review);
    return v_flex().id(id).gap(1).px(6).py(4).rounded(5).text_size(12).cursor_pointer()
      .hover((s) => s.bg(t.hover)).on_click(() => openUrl(pr.url))
      .child(h_flex().gap(6).items_center().text_size(11)
        .child(div().flex_none().w(12).text_color(tones[mark.tone]).child(mark.glyph))
        .child(div().min_w(0).truncate().text_color(t.muted).child(`${pr.repo.split("/").pop()}#${pr.number}`))
        .when(showAuthor, (el) => el.child(div().flex_none().text_color(t.dim).child(`@${pr.author}`)))
        .child(div().flex_1())
        .when(Boolean(review), (el) => el.child(div().flex_none().text_color(reviewTones[pr.review]).child(review)))
        .child(div().flex_none().text_color(t.dim).child(ago(pr.updated, now))))
      .child(div().pl(18).truncate().child(pr.title));
  }

  group(t, { id, title, rows }, now) {
    return v_flex().gap(1)
      .child(h_flex().gap(6).px(6).pt(4).text_size(11).font_semibold().text_color(t.muted)
        .child(div().child(title))
        .child(div().text_color(t.dim).child(String(rows.length))))
      .children(rows.map((pr, index) => this.row(t, pr, `prs-${id}-${index}`, id === "review", now)));
  }

  render() {
    const t = theme(), view = this.slot.value, now = Date.now();
    this.seen = this.slot.version;
    this.shownEmptyText = null;
    if (view?.kind !== PRS_VIEW.LIST || view.total === 0) {
      this.shownEmptyText = prsEmptyText(view, this.slot.at, now);
      return div().p(10).text_size(12).text_color(t.muted).child(this.shownEmptyText);
    }
    const note = listNote(view);
    return v_flex().p(4).gap(4)
      .children(view.groups.map((group) => this.group(t, group, now)))
      .when(Boolean(note), (el) => el.child(div().px(6).py(2).text_size(11).text_color(t.dim).child(note)));
  }
}

export const myPrs = {
  id: "prs",
  label: "My PRs & reviews",
  defaultOpen: false,
  fill: false,
  create(_props, cx) {
    const part = new MyPrs(cx);
    return {
      sync: (cx) => part.follow(cx),
      summary: () => prsSummary(part.slot.value),
      render: () => part.render(),
    };
  },
};
