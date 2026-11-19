// The Factory panel: the board's lanes stacked in a narrow side panel, one row
// per ticket, with links to the full board and the Run graph.
import { div } from "gpui-kit";
import * as herdr from "herdr";
import { v_flex, h_flex } from "gpui-base";
import { ACTIONS, boardLanes, nextUp } from "./board.js";
import { MOD_TABS, openModTab } from "./mod-tab.js";

const ROW_INDENT = 10;

function link(id, label, onClick, t) {
  return div().id(id).flex_none().px(6).py(2).rounded(5).text_size(12).text_color(t.muted).cursor_pointer()
    .hover((s) => s.bg(t.hover).text_color(t.foreground)).on_click((_e, cx) => onClick(cx)).child(label);
}

function runningStep(ticket) {
  return ticket.run?.steps.find((step) => step.status === "running")?.name ?? null;
}

function ticketRow(view, ticket, depth, isNext, color, t) {
  const step = ticket.state === "agent-working" ? runningStep(ticket) : null;
  const note = isNext ? "next up" : ticket.blockedBy.length ? `blocked by ${ticket.blockedBy.map((number) => `#${number}`).join(", ")}` : step;
  return v_flex().id(`panel-ticket-${ticket.number}`).flex_none().ml(depth * ROW_INDENT).px(8).py(4).gap(1).rounded(6).cursor_pointer()
    .border_l(2).border_color(ticket.blockedBy.length ? t.border : color)
    .hover((s) => s.bg(t.hover))
    .on_click((_e, cx) => view.act(ticket, ticket.worktree ? ACTIONS.worktree : ACTIONS.issue, cx))
    .child(h_flex().gap(6).items_center()
      .child(div().flex_none().text_size(11).text_color(t.dim).child(`#${ticket.number}`))
      .child(div().flex_1().min_w(0).truncate().text_size(12).child(ticket.title)))
    .when(Boolean(note), (el) => el.child(div().truncate().text_size(11).text_color(isNext ? color : t.dim).child(note)));
}

function lane(view, { key, title, cards }, isNextTicket, color, t) {
  return v_flex().id(`panel-lane-${key}`).flex_none().gap(2)
    .child(h_flex().h(26).mt(6).px(8).gap(8).items_center().text_size(11)
      .child(div().flex_1().font_semibold().text_color(color).child(title.toUpperCase()))
      .child(div().text_color(t.dim).child(String(cards.length))))
    .children(cards.map(({ ticket, depth }) => ticketRow(view, ticket, depth, isNextTicket(ticket), color, t)));
}

function header(view, t) {
  const repos = view.data?.repos ?? [];
  let bar = h_flex().h(42).flex_none().px(14).gap(4).items_center().border_b(1).border_color(t.border)
    .child(div().flex_none().font_semibold().mr(4).child("Factory"));
  if (repos.length > 1) bar = bar.child(link("panel-repo-prev", "‹", (cx) => view.pickRepo(-1, cx), t));
  bar = bar.child(div().flex_1().min_w(0).truncate().text_size(12).text_color(t.dim).child(view.data?.repo?.name ?? ""));
  if (repos.length > 1) bar = bar.child(link("panel-repo-next", "›", (cx) => view.pickRepo(1, cx), t));
  return bar
    .child(link("panel-board-open", "Board ↗", () => openModTab(herdr, MOD_TABS.factory), t))
    .child(link("panel-runs-open", "Runs ↗", () => openModTab(herdr, MOD_TABS.runGraph), t));
}

export function factoryPanel(view, laneColor, t) {
  const root = v_flex().id("factory-panel").size_full().min_h(0).rounded(10).overflow_hidden().bg(t.background)
    .border_1().border_color(t.border).text_color(t.foreground).text_size(13).child(header(view, t));
  if (!view.data?.repo) {
    const message = view.error ?? (view.data ? "No repo open in herdr has a .factory.json." : "Loading…");
    return root.child(div().p(12).text_size(12).text_color(t.dim).child(message));
  }
  const next = nextUp(view.data.tickets);
  return root.child(v_flex().id("factory-panel-lanes").flex_1().min_h(0).overflow_y_scrollbar().p(6)
    .children(boardLanes(view.data.tickets).map((each) => lane(view, each, (ticket) => ticket === next, laneColor(t, each.key), t))));
}
