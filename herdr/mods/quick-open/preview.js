// The read-only preview of the selected file, at a line. One load at a time
// counts: a newer show() drops an older read's result.
import { readTextFile } from "herdr";
import { createCode } from "./code.js";
import { isBinary, rangeFor, shown } from "./text.js";

export const PREVIEW_ERROR_CODES = Object.freeze({
  missing: "preview_missing",
  binary: "preview_binary",
  unreadable: "preview_unreadable",
});

export const PREVIEW_MESSAGES = {
  [PREVIEW_ERROR_CODES.missing]: "This file is no longer there",
  [PREVIEW_ERROR_CODES.binary]: "Binary file · no preview",
  [PREVIEW_ERROR_CODES.unreadable]: "Cannot preview this file (too large or unreadable)",
};

export class Preview {
  constructor() {
    this.key = null; this.code = null; this.error = null;
  }

  show(root, target, cx) {
    const key = target ? `${root}/${target.path}:${target.line ?? 1}` : null;
    if (key === this.key) return;
    this.key = key;
    if (!target) return this.clear();
    cx.spawn(async (cx) => {
      let text = null;
      let error = null;
      try {
        text = await readTextFile(`${root}/${target.path}`);
        if (text === null) error = PREVIEW_ERROR_CODES.missing;
        else if (isBinary(text)) error = PREVIEW_ERROR_CODES.binary;
      } catch {
        error = PREVIEW_ERROR_CODES.unreadable;
      }
      if (this.key !== key) return;
      this.clear();
      this.error = error;
      if (!error) {
        const value = shown(text);
        this.code = createCode(target.path, value);
        this.code.set_selected_range(rangeFor(value, target));
      }
      cx.notify();
    });
  }

  clear() {
    this.code?.release(); this.code = null; this.error = null;
  }

  release() {
    this.key = null;
    this.clear();
  }
}
