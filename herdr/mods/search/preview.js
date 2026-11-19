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

const targetKey = ({ line, column, length }) => `${line}:${column ?? 0}:${length ?? 0}`;

export class Preview {
  constructor() {
    this.file = null; this.wanted = null; this.target = null; this.code = null; this.error = null;
  }

  show(file, target, cx) {
    this.wanted = target;
    if (file === this.file) return this.select();
    this.file = file;
    this.target = null;
    if (!file) return this.clear();
    cx.spawn(async (cx) => {
      let text = null;
      let error = null;
      try {
        text = await readTextFile(file);
        if (text === null) error = PREVIEW_ERROR_CODES.missing;
        else if (isBinary(text)) error = PREVIEW_ERROR_CODES.binary;
      } catch {
        error = PREVIEW_ERROR_CODES.unreadable;
      }
      if (this.file !== file) return;
      this.clear();
      this.error = error;
      if (!error) this.code = createCode(file, shown(text));
      this.select();
      cx.notify();
    });
  }

  select() {
    const target = this.wanted;
    if (!this.code || !target || (this.target && targetKey(this.target) === targetKey(target))) return;
    this.target = target;
    this.code.set_selected_range(rangeFor(this.code.value(), target));
  }

  clear() {
    this.code?.release(); this.code = null; this.error = null; this.target = null;
  }

  release() {
    this.file = null;
    this.clear();
  }
}
