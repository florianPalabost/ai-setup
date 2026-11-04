// The Commits section: the current branch, read-only, with a thin lane column.
// A click takes the commit to the Graph tab, which is where anything more happens.
import { div } from "gpui-kit";
import { h_flex, v_flex } from "gpui-base";
import * as herdr from "herdr";
import { COMMITS_VIEW, commitsSummary, emptyText, laneWidth, loadCommits } from "./commits-data.js";
import { openGraphTab } from "./graph-tab.js";
import { locate } from "./pr-data.js";

// Local reads, so cheap enough to catch a commit made anywhere.
const TICK_MS = 10000;
const COMMIT_ROW = 22, JOIN_ROW = 12;
// The panel is narrow: a long branch name mustn't push the subject out.
const REF_MAX = 80;

const here = () => locate({ spaces: herdr.spaces(), focused: herdr.focused(), panes: herdr.panes() });
const keyOf = ({ cwd, on, branch }) => JSON.stringify([cwd, on, branch]);

class Commits {
  constructor(cx) {
    this.view = null;
    this.key = null;
    this.asked = 0;
    this.loading = false;
    this.follow(cx);
    cx.timer.every(TICK_MS, (cx) => {
      if (!this.loading && (herdr.window()?.active ?? true)) this.load(cx, here());
    });
  }

  // Runs on every panel render, so a cd or branch change shows while collapsed too.
  follow(cx) {
    const at = here();
    if (keyOf(at) !== this.key) this.load(cx, at);
  }

  // Keeps the last list until the answer. Each redraw redraws the whole window, so only for a new one.
  load(cx, at) {
    this.key = keyOf(at);
    const asked = ++this.asked;
    this.loading = true;
    cx.spawn(async (cx) => {
      const view = await loadCommits(herdr.exec, at);
      if (asked !== this.asked) return;
      this.loading = false;
      const changed = JSON.stringify(view) !== JSON.stringify(this.view);
      this.view = view;
      if (changed) cx.notify();
    });
  }

  row(t, row, lane, mono, root) {
    const lanes = div().w(lane).flex_none().overflow_hidden().whitespace_nowrap().font_family(mono).text_size(11).text_color(t.accent).child(row.graph);
    if (!row.hash) return h_flex().h(JOIN_ROW).flex_none().px(10).items_center().child(lanes);
    return h_flex().id(`commit-${row.hash}`).h(COMMIT_ROW).flex_none().px(10).gap(6).items_center().rounded(5)
      .cursor_pointer().hover((s) => s.bg(t.hover))
      .on_click(() => openGraphTab(herdr, { folder: root, commit: row.hash }))
      .child(lanes)
      .when(Boolean(row.refs), (el) => el.child(div().flex_none().max_w(REF_MAX).truncate().px(4).rounded(4).border(1).border_color(t.border).text_size(10).text_color(t.muted).child(row.refs)))
      .child(div().flex_1().min_w(0).truncate().child(row.subject))
      .child(div().flex_none().text_size(10.5).text_color(t.dim).child(row.age));
  }

  render() {
    const t = herdr.theme(), view = this.view;
    if (view?.kind !== COMMITS_VIEW.LIST) return div().p(10).text_size(12).text_color(t.muted).child(emptyText(view));
    const lane = laneWidth(view.rows), mono = herdr.settings().font_family;
    return v_flex().py(4).text_size(12).children(view.rows.map((row) => this.row(t, row, lane, mono, view.root)));
  }
}

export const commits = {
  id: "commits",
  label: "Commits",
  defaultOpen: false,
  fill: false,
  create(_props, cx) {
    const part = new Commits(cx);
    return {
      sync: (cx) => part.follow(cx),
      summary: () => commitsSummary(part.view),
      render: () => part.render(),
    };
  },
};
