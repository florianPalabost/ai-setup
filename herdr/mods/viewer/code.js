import { EditorState } from "gpui-base";
import { theme, settings } from "herdr";
import { languageFor } from "./text.js";

const FONT_SIZE = 13;

export function createCode(path, text, { readonly = true } = {}) {
  const t = theme();
  return EditorState.new({
    language: languageFor(path),
    readonly,
    value: text,
    font_family: settings().font_family,
    font_size: FONT_SIZE,
    syntax: { keyword: t.ansi5, string: t.ansi2, comment: t.dim, function: t.ansi4, type: t.ansi3, number: t.ansi1, constant: t.ansi6 },
  });
}
