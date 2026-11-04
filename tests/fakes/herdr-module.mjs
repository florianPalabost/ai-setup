// Fake of the `herdr` module. Everything a mod asks of herdr goes through `world`,
// which a test sets up and reads back. exec really runs the program, so a mod's
// git commands meet real repositories.
import { spawnSync } from "node:child_process";

const color = new Proxy({}, { get: () => "#000000" });

export const world = {
  spaces: [], panes: [], focused: null, props: {}, shared: {}, runs: [], execs: [], overlays: [], notes: [], windowActive: true, execGate: null,
};

export function resetWorld(change = {}) {
  Object.assign(world, { spaces: [], panes: [], focused: null, props: {}, shared: {}, runs: [], execs: [], overlays: [], notes: [], windowActive: true, execGate: null }, change);
}

export const spaces = () => world.spaces;
export const panes = () => world.panes;
export const focused = () => world.focused;
export const window = () => ({ active: world.windowActive });
export const props = () => world.props;
export const shared = (key) => world.shared[key];
export const setShared = (key, value) => { world.shared[key] = value; return null; };
export const run = (name, args) => { world.runs.push({ name, args }); return null; };
export const theme = () => color;
export const settings = () => ({ zoom: 1, font_family: "mono" });
export const home = () => "/home/test";
export const openOverlay = (spec) => { world.overlays.push(spec); return `overlay-${world.overlays.length}`; };
export const closeOverlay = () => null;
export const notify = (note) => { world.notes.push(note); return null; };
export const readTextFile = async () => "";
// A folder watch that ends at once: tests refresh by hand.
export const watchFolder = async () => { throw new Error("not watching in tests"); };

export async function exec(program, args, { cwd } = {}) {
  world.execs.push({ program, args, cwd });
  // A test can hold a call back with this, to make answers arrive out of order.
  await world.execGate?.({ program, args, cwd });
  const result = spawnSync(program, args, { cwd, encoding: "utf8", maxBuffer: 1 << 28 });
  if (result.error) throw result.error;
  return { code: result.status, stdout: result.stdout, stderr: result.stderr };
}
