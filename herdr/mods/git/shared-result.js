// One result per view, shared by every open copy of the mod, so copies make one
// gh call between them. Each copy gets its own module instances, but globalThis
// is common to all of them (seen on herdr-app 0.1.12). Only touch it from a
// function: herdr runs a broken save's top-level code too.
const SLOTS = "__gitPanelSlots";
// `kind` of the result when a load threw, beside the kinds each section's load returns.
export const LOAD_VIEW = Object.freeze({ ERROR: "error" });
// exec's own limit is 30 s. A copy closing mid-call may leave its promise unsettled.
const STUCK_AFTER_MS = 35000;

export function sharedSlot(name, realm = globalThis) {
  const slots = (realm[SLOTS] ??= {});
  return (slots[name] ??= { key: null, value: null, at: 0, version: 0, pending: null, startedAt: 0 });
}

const running = (slot, now) => slot.pending !== null && now - slot.startedAt < STUCK_AFTER_MS;

// Starts load() for this view unless it's already running, and returns a promise
// that any copy can wait on. The last value stays in the slot until the new one
// arrives, so a cd never blanks the section.
export function startRefresh(slot, key, load, clock = Date.now) {
  const now = clock();
  if (slot.key === key && running(slot, now)) return slot.pending;
  slot.key = key;
  slot.startedAt = now;
  const run = (async () => {
    let value;
    try {
      value = await load();
    } catch (error) {
      value = { kind: LOAD_VIEW.ERROR, message: String(error?.message ?? error) };
    }
    if (slot.pending !== run) return;
    slot.pending = null;
    slot.at = clock();
    if (JSON.stringify(value) !== JSON.stringify(slot.value)) slot.version++;
    slot.value = value;
  })();
  slot.pending = run;
  return run;
}

// Whether this copy should start a refresh now, and whether it may use gh's
// cache: { cache } or null. interval is how long this result stays good.
export function refreshDue(slot, key, { active, now, interval }) {
  if (slot.key === null) return { cache: true };
  if (slot.key !== key) return { cache: false };
  if (running(slot, now) || !active) return null;
  return now - slot.at >= interval ? { cache: true } : null;
}
