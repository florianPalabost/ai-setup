// Fixture: the lines of herdr's tabs mod that matter to tabs.patch, moved around
// so a patch has to find them by content.
const enabled = shared("workspace.panels") ?? ["files", "changes"];
export const buttons = (el, panelButton, svg) => el
      .when(enabled.includes("files"), el => el.child(panelButton("files", "Files", "mods/files/file.svg")))
      .when(enabled.includes("changes"), el => el.child(panelButton("changes", "Changes", "mods/changes/changes.svg")))
      .child(svg("mods/tabs/win-min.svg"));
