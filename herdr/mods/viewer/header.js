// The Viewer's top bar: the path (● while it has unsaved edits), a notice
// when the edits are at risk, and the buttons that fit the moment.
import { div } from "gpui-kit";
import { h_flex, v_flex } from "gpui-base";

function button(id, label, onClick, t, primary = false) {
  return div().id(id).flex_none().px(8).py(3).rounded(6).text_size(12).cursor_pointer()
    .bg(primary ? t.solid : t.raised).text_color(primary ? t.solid_foreground : t.foreground)
    .hover((s) => s.opacity(0.85))
    .on_click((_event, cx) => onClick(cx))
    .child(label);
}

function notice(state) {
  if (state.pending) return `Unsaved edits in ${state.path}. Save them or drop them to open ${state.pending.path}.`;
  if (state.conflict) return "The file changed on disk while you were editing it.";
  if (state.saveError) return `Not saved: ${state.saveError}`;
  return null;
}

function buttons(state, actions, t) {
  if (state.pending) {
    return [button("viewer-save-next", "Save and open", actions.saveAndContinue, t, true), button("viewer-drop-next", "Drop edits", actions.dropAndContinue, t)];
  }
  if (state.conflict) {
    return [button("viewer-reload", "Reload from disk", actions.reload, t), button("viewer-overwrite", "Overwrite with mine", actions.overwrite, t, true)];
  }
  const out = [];
  if (state.dirty) out.push(button("viewer-save", "Save", actions.save, t, true));
  if (state.path && !state.error) out.push(button("viewer-vscode", "Open in VS Code", actions.openInVsCode, t));
  return out;
}

export function viewerHeader(state, actions, t) {
  const message = notice(state);
  const title = state.path ? `${state.dirty ? "● " : ""}${state.path}` : "Viewer";
  const bar = h_flex().h(36).flex_none().px(12).gap(8).items_center()
    .child(div().flex_1().min_w(0).truncate().text_color(state.path ? t.foreground : t.dim).child(title))
    .when(state.readonly, (el) => el.child(div().flex_none().text_size(11).text_color(t.dim).child("read-only: too large to edit")))
    .children(buttons(state, actions, t));
  return v_flex().flex_none().border_b(1).border_color(t.border)
    .child(bar)
    .when(Boolean(message), (el) => el.child(div().px(12).pb(8).text_size(12).text_color(t.blocked).child(message)));
}
