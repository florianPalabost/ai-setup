import { View } from "gpui-kit";
import { props } from "herdr";
import { Graph } from "./graph.js";
import { Menu } from "./menu.js";

// One mod, two roles: the graph (a panel or a pane), and over the window its
// right-click menu (props.role).
export default class GitGraph extends View {
  init(_props, cx) {
    this.part = props()?.role === "menu" ? new Menu() : new Graph();
    this.part.init(cx);
  }

  render(cx) { return this.part.render(cx); }
}
