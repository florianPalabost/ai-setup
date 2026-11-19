// The Factory board: the factory's tickets as a kanban. Lanes: Needs you, Working,
// Done · draft PR, Ready. A blocked ticket sits under the one blocking it, and
// the ticket `factory next` would pick is marked "next up". With `panel` in its
// props it is the Factory panel instead (panel.js).
import { View, div } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { exec, readTextFile, spaces, panes, theme, run, notify, window, checking, props, layout, setShared } from "herdr";
import { ACTIONS, STEP_MARKS, boardLanes, cardActions, cardTags, nextUp, sinceLabel } from "./board.js";
import { createOpener } from "./opener.js";
import { createFactorySource } from "./source.js";
import { factoryPanel } from "./panel.js";

const POLL_INTERVAL_MS = 5000;
const REPO_KEY = "factory-board.repo";
const LANE_MIN_WIDTH = 180;
const CHILD_INDENT = 14;
// Opens a run's Markdown log in the person's pager, the path kept out of the script.
const PAGER_SCRIPT = 'exec "${PAGER:-less}" "$1"';
// The Bottom panel's Output tab follows the ticket this shared value names (bottom-output/main.js).
const OUTPUT_FOLLOW_KEY = "bottom-output.follow";
const BOTTOM_PANEL = "bottom";

const hasNode = (node, id) => node?.id === id || (node?.children ?? []).some((child) => hasNode(child, id));

const laneColor = (t, key) => ({ human: t.ansi1, working: t.ansi3, done: t.ansi2, ready: t.ansi4 })[key] ?? t.dim;
const stepColor = (t, status) => ({ done: t.ansi2, pass: t.ansi2, fail: t.ansi1, error: t.ansi1, running: t.ansi3 })[status] ?? t.dim;

export default class FactoryBoard extends View {
  init(_props, cx) {
    this.source = createFactorySource({ exec, readTextFile, spaces, panes });
    this.openUrl = createOpener({ platform: () => window().platform, readTextFile, exec, warn: (body) => this.warn("Link not opened", body) });
    this.data = null; this.error = null; this.loading = false; this.panel = Boolean(props()?.panel);
    this.root = localStorage.getItem(REPO_KEY);
    if (checking()) return;
    this.refresh(cx);
    cx.timer.every(POLL_INTERVAL_MS, (cx) => this.refresh(cx));
  }

  warn(title, body) { notify({ title, body, level: "warning" }); }

  refresh(cx) {
    if (this.loading) return;
    this.loading = true;
    cx.spawn(async (cx) => {
      try {
        this.data = await this.source.getFactory(this.root);
        this.error = null;
      } catch (e) {
        this.error = `${e?.code ?? "error"}: ${e?.message ?? e}`;
      } finally {
        this.loading = false;
        cx.notify();
      }
    });
  }

  pickRepo(by, cx) {
    const repos = this.data?.repos ?? [];
    if (repos.length < 2) return;
    const index = repos.findIndex((repo) => repo.root === this.data.repo?.root);
    this.root = repos[(index + by + repos.length) % repos.length].root;
    localStorage.setItem(REPO_KEY, this.root);
    this.refresh(cx);
  }

  // The space already working in the worktree, else a new one there.
  openWorktree(ticket) {
    const { on } = this.data.repo;
    const inside = (folder) => folder === ticket.worktree || folder?.startsWith(`${ticket.worktree}/`);
    const space = spaces().find((candidate) => (candidate.machine ?? null) === on
      && (inside(candidate.folder) || panes().some((pane) => inside(pane.cwd) && candidate.tabs.some((tab) => tab.id === pane.tab))));
    if (space) run("space.select", { id: space.id });
    else run("space.new", { folder: ticket.worktree, machine: on ?? undefined });
  }

  openTerminal(ticket, command) {
    run("terminal.open", { argv: ["factory", command, String(ticket.number), "--repo", this.data.repo.root], folder: ticket.worktree, place: "tab" });
  }

  // In the Bottom panel's Output tab when the layout has it, else in a terminal tab.
  watch(ticket) {
    if (!hasNode(layout(), BOTTOM_PANEL)) return this.openTerminal(ticket, ACTIONS.watch);
    setShared(OUTPUT_FOLLOW_KEY, { issue: ticket.number, at: Date.now() });
    run("layout.show", { id: BOTTOM_PANEL });
  }

  act(ticket, action, cx) {
    const repo = this.data?.repo;
    if (!repo) return;
    if (action === ACTIONS.worktree) return this.openWorktree(ticket);
    if (action === ACTIONS.watch) return this.watch(ticket);
    if (action === ACTIONS.resume) return this.openTerminal(ticket, action);
    if (action === ACTIONS.issue) return void this.openUrl(ticket.url);
    if (action === ACTIONS.pr) return void this.openUrl(ticket.pr?.url);
    if (action === ACTIONS.log) {
      cx.spawn(async () => {
        try {
          const path = await this.source.logPath(repo, ticket.number);
          run("terminal.open", { argv: ["sh", "-c", PAGER_SCRIPT, "factory-log", path], folder: repo.root, place: "tab" });
        } catch (e) {
          this.warn(`No log for #${ticket.number}`, e?.message ?? String(e));
        }
      });
    }
  }

  header(t) {
    const repos = this.data?.repos ?? [];
    const status = this.error ?? (!this.data ? "Loading…" : !this.data.repo ? "" : `${this.data.tickets.length} tickets · GitHub ${sinceLabel(this.data.githubCheckedAt)}`);
    const button = (id, label, onClick) => div().id(id).flex_none().px(6).py(2).rounded(5).text_color(t.muted).cursor_pointer()
      .hover((s) => s.bg(t.hover).text_color(t.foreground)).on_click((_e, cx) => onClick(cx)).child(label);
    let header = h_flex().id("factory-header").h(36).flex_none().px(10).gap(6).items_center().border_b(1).border_color(t.border)
      .child(div().flex_none().font_semibold().child("Factory"));
    if (repos.length > 1) header = header.child(button("repo-prev", "‹", (cx) => this.pickRepo(-1, cx)));
    header = header.child(div().flex_none().text_color(t.muted).child(this.data?.repo?.name ?? ""));
    if (repos.length > 1) header = header.child(button("repo-next", "›", (cx) => this.pickRepo(1, cx)));
    return header
      .child(div().flex_1().min_w(0).truncate().text_right().text_size(11).text_color(this.error ? t.ansi1 : t.dim).child(status))
      .child(button("factory-refresh", "↻", (cx) => { this.source.forgetRepos(); this.refresh(cx); }));
  }

  steps(t, ticketRun) {
    const rows = ticketRun.steps.map((step, index) => h_flex().gap(6).text_size(11)
      .child(div().flex_none().w(10).text_color(stepColor(t, step.status)).child(STEP_MARKS[step.status] ?? "·"))
      .child(div().flex_1().min_w(0).truncate().text_color(step.status === "running" ? t.foreground : t.muted).child(step.name))
      .id(`step-${index}`));
    if (ticketRun.activity) {
      rows.push(div().truncate().text_size(11).text_color(t.dim).child(`${sinceLabel(ticketRun.updatedAt)} · ${ticketRun.activity}`));
    }
    return v_flex().gap(2).children(rows);
  }

  card(ticket, depth, isNext, t, color) {
    const tags = cardTags(ticket, { isNext });
    const actions = cardActions(ticket);
    const tag = ({ text, next }) => div().flex_none().px(5).rounded(4).text_size(10).border(1)
      .border_color(next ? color : t.border).text_color(next ? color : t.muted).child(text);
    let box = v_flex().id(`ticket-${ticket.number}`).ml(depth * CHILD_INDENT).p(8).gap(6).rounded(8).bg(t.surface)
      .border(1).border_color(ticket.blockedBy.length ? t.border : color).border_l(depth ? 2 : 4)
      .cursor_pointer().hover((s) => s.bg(t.hover))
      .on_click((_e, cx) => this.act(ticket, ticket.worktree ? ACTIONS.worktree : ACTIONS.issue, cx))
      .child(h_flex().gap(6).items_start()
        .child(div().flex_none().text_color(t.dim).child(`#${ticket.number}`))
        .child(div().flex_1().min_w(0).child(ticket.title)));
    if (tags.length) box = box.child(h_flex().flex_wrap().gap(4).children(tags.map(tag)));
    if (ticket.state === "agent-working" && ticket.run) box = box.child(this.steps(t, ticket.run));
    return box.child(h_flex().flex_wrap().gap(4).children(actions.map(({ label, action }) =>
      div().id(`${ticket.number}-${action}`).px(6).py(1).rounded(5).text_size(11).border(1).border_color(t.border).text_color(t.muted)
        .cursor_pointer().hover((s) => s.bg(t.background).text_color(t.foreground))
        .on_click((_e, cx) => { cx.stop_propagation(); this.act(ticket, action, cx); }).child(label))));
  }

  lane(lane, isNextTicket, t) {
    const color = laneColor(t, lane.key);
    return v_flex().id(`lane-${lane.key}`).flex_1().min_w(LANE_MIN_WIDTH).min_h(0).gap(6)
      .child(h_flex().flex_none().pb(4).gap(6).border_b(2).border_color(color)
        .child(div().flex_1().font_semibold().text_color(color).child(lane.title))
        .child(div().text_color(t.dim).child(String(lane.cards.length))))
      .child(v_flex().id(`lane-body-${lane.key}`).flex_1().min_h(0).gap(6).overflow_y_scroll()
        .children(lane.cards.length ? lane.cards.map(({ ticket, depth }) => this.card(ticket, depth, isNextTicket(ticket), t, color))
          : [div().text_size(11).text_color(t.dim).child("None")]));
  }

  render(_cx) {
    const t = theme();
    if (this.panel) return factoryPanel(this, laneColor, t);
    const root = v_flex().id("factory-board").size_full().min_h(0).bg(t.background).text_color(t.foreground).text_size(13).child(this.header(t));
    if (!this.data?.repo) {
      const message = this.error ? "Can't read the factory." : this.data ? "No repo open in herdr has a .factory.json." : "Loading…";
      return root.child(div().p(16).text_color(t.dim).child(message));
    }
    const next = nextUp(this.data.tickets);
    return root.child(h_flex().id("factory-lanes").flex_1().min_h(0).p(10).gap(12).items_start().overflow_x_scroll()
      .children(boardLanes(this.data.tickets).map((lane) => this.lane(lane, (ticket) => ticket === next, t))));
  }
}
