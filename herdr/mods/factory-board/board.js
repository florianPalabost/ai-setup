// What the Factory board shows, free of the herdr runtime so it can run under
// `node --test`. Mirrors the Orca plugin's Factory panel (orca-plugins/orch-dag/panel/factory.js).

export const LANES = Object.freeze([
  { state: "ready-for-human", key: "human", title: "Needs you" },
  { state: "agent-working", key: "working", title: "Working" },
  { state: "agent-done", key: "done", title: "Done · draft PR" },
  { state: "ready-for-agent", key: "ready", title: "Ready" },
]);

export const RUN_OUTCOMES = Object.freeze({ "agent-done": "done", "ready-for-human": "handed to you", error: "stopped on an error" });
export const STEP_MARKS = Object.freeze({ done: "✓", pass: "✓", fail: "✗", error: "✗", running: "▸" });

// A ticket's worktree, e.g. ~/dev/lara-vision-factory/issue-42: never a factory repo of its own.
export const FACTORY_WORKTREE_PATTERN = /-factory[\\/]issue-\d+$/;

export function sinceLabel(isoTime, now = Date.now()) {
  const minutes = Math.max(0, Math.round((now - new Date(isoTime).getTime()) / 60000));
  if (minutes < 60) return `${minutes}m ago`;
  return minutes < 48 * 60 ? `${Math.floor(minutes / 60)}h ago` : `${Math.floor(minutes / 1440)}d ago`;
}

// The oldest unblocked ready ticket: the one `factory next` picks.
export function nextUp(tickets) {
  return tickets.filter((ticket) => ticket.state === "ready-for-agent" && ticket.blockedBy.length === 0)
    .sort((left, right) => left.number - right.number)[0] ?? null;
}

// Orders a lane so each ticket sits right under the ticket blocking it (chains read top to bottom).
export function chainOrder(tickets) {
  const inLane = new Map(tickets.map((ticket) => [ticket.number, ticket]));
  const childrenOf = new Map();
  const roots = [];
  for (const ticket of tickets) {
    const parent = ticket.blockedBy.find((number) => inLane.has(number));
    if (parent) childrenOf.set(parent, [...(childrenOf.get(parent) ?? []), ticket]);
    else roots.push(ticket);
  }
  const ordered = [];
  const visit = (ticket, depth) => {
    ordered.push({ ticket, depth });
    for (const child of childrenOf.get(ticket.number) ?? []) visit(child, depth + 1);
  };
  roots.forEach((ticket) => visit(ticket, 0));
  return ordered;
}

// The lanes, each with its tickets in chain order.
export function boardLanes(tickets) {
  return LANES.map((lane) => ({ ...lane, cards: chainOrder(tickets.filter((ticket) => ticket.state === lane.state)) }));
}

// The GitHub tickets, each carrying its newest local run when there is one.
export const withLocalRuns = (tickets, runs) => tickets.map((ticket) => ({ ...ticket, run: runs[ticket.number] ?? ticket.run }));

// The buttons a card gets, in order: { label, action } with action one of ACTIONS.
export const ACTIONS = Object.freeze({ worktree: "worktree", watch: "watch", resume: "resume", issue: "issue", pr: "pr", log: "log" });

export function cardActions(ticket) {
  const actions = [];
  if (ticket.worktree) {
    actions.push({ label: "Worktree", action: ACTIONS.worktree });
    if (ticket.run && !ticket.run.finishedAt) actions.push({ label: "Watch", action: ACTIONS.watch });
    if (ticket.run?.finishedAt && ticket.run.steps.some((step) => step.sessionId)) actions.push({ label: "Resume", action: ACTIONS.resume });
  }
  actions.push({ label: "Issue", action: ACTIONS.issue });
  if (ticket.pr) actions.push({ label: `PR #${ticket.pr.number}${ticket.pr.isDraft ? " draft" : ""}`, action: ACTIONS.pr });
  if (ticket.run) actions.push({ label: "Log", action: ACTIONS.log });
  return actions;
}

// The small tags under a card's title.
export function cardTags(ticket, { isNext, now = Date.now() }) {
  const tags = [];
  if (isNext) tags.push({ text: "next up", next: true });
  if (ticket.blockedBy.length) tags.push({ text: `blocked by ${ticket.blockedBy.map((number) => `#${number}`).join(", ")}` });
  if (ticket.run?.outcome && ticket.state !== "agent-working") {
    tags.push({ text: `last run: ${RUN_OUTCOMES[ticket.run.outcome] ?? ticket.run.outcome} · ${sinceLabel(ticket.run.finishedAt, now)}` });
  }
  return tags;
}
