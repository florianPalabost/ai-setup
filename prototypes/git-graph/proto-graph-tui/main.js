// PROTOTYPE (wayfinder #5): the "TUI" option for the git graph. Throwaway.
//
// Opened with `mod.open` (an overlay), it starts a terminal right of the focused
// pane running `git log --graph` paged by `less`, in the focused pane's folder,
// then closes itself. `q` quits less and the pane closes with it.
// Opened as a tab or pane (`tab.new {mod, props: {folder}}`), it shows a button
// that does the same for props.folder.
// Read-only: it runs `git log` only. No network, no writes.
import { View, div } from "gpui-kit";
import { v_flex } from "gpui-base";
import { props, focused, run, closeOverlay, theme } from "herdr";

const SCRIPT = "git log --graph --oneline --decorate --all --color=always | less -RS";

export function openGraphTerminal(folder) {
  run("terminal.open", { argv: ["sh", "-c", SCRIPT], folder: folder ?? undefined, place: "right", name: "git graph" });
}

export default class ProtoGraphTui extends View {
  init(_props, cx) {
    const p = props() ?? {};
    this.folder = p.folder ?? focused()?.cwd ?? null;
    if (p.overlay) {
      openGraphTerminal(this.folder);
      closeOverlay(p.overlay);
    }
  }

  render() {
    const t = theme();
    return v_flex().id("proto-graph-tui").size_full().p(16).gap(10).bg(t.background).text_color(t.foreground).text_size(13)
      .child(div().font_semibold().child("proto-graph-tui"))
      .child(div().text_color(t.muted).child(`Folder: ${this.folder ?? "(focused pane)"}`))
      .child(div().text_color(t.dim).child(SCRIPT))
      .child(div().id("open").w(220).px(12).py(6).rounded(6).bg(t.solid).text_color(t.solid_foreground).cursor_pointer()
        .hover((s) => s.opacity(0.88))
        .on_click(() => openGraphTerminal(this.folder))
        .child("Open graph terminal →"));
  }
}
