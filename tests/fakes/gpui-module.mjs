// Fake of the gpui-kit and gpui-base modules: elements that remember their text,
// ids and handlers, so a test can read and click what a mod rendered.
const HANDLERS = new Set(["on_click", "on_mouse_down", "on_mouse_move", "on_mouse_up", "on_hover", "on_key_down", "on_size_change",
  "on_item_click", "on_item_secondary_click"]);

function element(extra = {}) {
  const state = { kids: [], handlers: {}, elementId: null, ...extra };
  const self = new Proxy(state, {
    get(target, name) {
      if (name in target) return target[name];
      if (name === "then") return undefined;
      if (name === "child") return (kid) => { target.kids.push(kid); return self; };
      if (name === "children") return (kids) => { target.kids.push(...kids); return self; };
      if (name === "when") return (on, fn) => (on ? fn(self) : self);
      if (name === "id") return (id) => { target.elementId = id; return self; };
      if (name === "hover") return () => self;
      if (HANDLERS.has(name)) return (...args) => { target.handlers[name] = args[args.length - 1]; return self; };
      if (name === "track_scroll") return (handle) => { target.scroll = handle; return self; };
      return () => self;
    },
  });
  return self;
}

export class View {}
export const div = () => element();
export const v_flex = () => element();
export const h_flex = () => element();
export const svg = (path) => element({ svg: path });
export const Scrollbar = { vertical: () => element() };
export const v_virtual_list = (id, count, size, key, render) => element({ list: { id, count, key, render } });
export const VirtualListScrollHandle = {
  new: () => ({ scrolledTo: [], scroll_to_item(index, strategy) { this.scrolledTo.push({ index, strategy }); }, release() { return true; } }),
};

const stroke = () => new Proxy({}, { get: (_t, name, self) => (name === "then" ? undefined : () => self) });
export const PathBuilder = { stroke };

globalThis.window = { paint_path: () => element() };
