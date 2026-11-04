// Runs a mod's view outside herdr: a fake cx, plus reading and clicking what it rendered.
import { register } from "node:module";

register(new URL("./mod-hooks.mjs", import.meta.url));

export function fakeCx() {
  const tasks = new Set(), timers = [];
  const cx = {
    timers,
    notified: 0,
    notify() { cx.notified++; },
    spawn(fn) {
      const task = Promise.resolve().then(() => fn(cx)).finally(() => tasks.delete(task));
      tasks.add(task);
    },
    timer: {
      after(ms, fn) { timers.push({ ms, fn, repeats: false }); },
      every(ms, fn) { timers.push({ ms, fn, repeats: true }); },
    },
    focus_handle: () => ({ focus() {} }),
    stop_propagation() {},
    write_to_clipboard() {},
    // Every task started so far, and those they started.
    async settle() { while (tasks.size) await Promise.allSettled([...tasks]); },
    // Fires the one-off timers set for `ms`.
    fire(ms) {
      for (const timer of timers.filter((t) => !t.repeats && t.ms === ms)) {
        timers.splice(timers.indexOf(timer), 1);
        timer.fn(cx);
      }
    },
  };
  return cx;
}

export function walk(element, visit) {
  if (element === null || typeof element !== "object") return;
  visit(element);
  for (const kid of element.kids ?? []) walk(kid, visit);
}

export function textOf(element) {
  if (typeof element === "string") return element;
  const kids = element?.kids ?? [];
  return kids.map(textOf).filter(Boolean).join(" ");
}

export function findById(root, id) {
  let found = null;
  walk(root, (el) => { if (el.elementId === id) found = el; });
  return found;
}

export function findList(root) {
  let found = null;
  walk(root, (el) => { if ("list" in el) found = el; });
  return found;
}

// The element holding the list: it takes the press that comes before a click.
export function findPressTarget(root) {
  let found = null;
  walk(root, (el) => { if (el.kids?.some((kid) => typeof kid === "object" && "list" in kid)) found = el; });
  return found;
}
