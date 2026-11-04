// Where the person is looking, which is what the sections follow. Takes herdr's
// data as arguments, so node can test it.

// A focused mod pane keeps the tab's first terminal, so clicking the panel doesn't lose the repo.
export function locate({ spaces, focused, panes }) {
  const space = spaces.find((s) => s.active);
  let pane = focused?.pane ? panes.find((p) => p.pane === focused.pane && p.terminal) : null;
  if (!pane && focused?.pane) pane = panes.find((p) => p.tab === focused.tab && p.terminal && p.cwd);
  const blockMachine = focused?.pane === null && focused.terminal?.includes("/") ? focused.terminal.split("/")[0] : null;
  return {
    cwd: pane?.cwd || focused?.cwd || space?.folder || null,
    on: blockMachine ?? space?.machine ?? null,
    branch: pane?.branch ?? space?.branch ?? null,
  };
}

// `herdr` is the herdr module.
export const here = (herdr) => locate({ spaces: herdr.spaces(), focused: herdr.focused(), panes: herdr.panes() });

// What makes this a different place to a section: a change means a cd or a branch change.
export const placeKey = ({ cwd, on, branch }) => JSON.stringify([cwd, on, branch]);
