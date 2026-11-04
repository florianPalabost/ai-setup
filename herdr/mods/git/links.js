// Sections open links with openUrl(url): see opener.js for what it runs.
import { exec, notify, readTextFile, window } from "herdr";
import { createOpener } from "./opener.js";

export const openUrl = createOpener({
  platform: () => window().platform,
  readTextFile,
  exec,
  warn: (body) => { notify({ title: "Link not opened", body, level: "warning" }); },
});
