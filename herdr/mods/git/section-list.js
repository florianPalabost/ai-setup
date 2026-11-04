// The sections of the Git panel, top to bottom. Each one is:
//   id           key for the remembered open state
//   label        header text
//   defaultOpen  open until the person chooses otherwise
//   fill         true: takes the panel's leftover height. false: sizes to its
//                content, up to 40% of the panel, and scrolls beyond that
//   create(props, cx)  builds the section, returning { summary(), render(cx) }:
//                summary() is the header's text, render(cx) the body. Use cx
//                as a View would: cx.notify() redraws the panel. An optional
//                sync(cx) runs on every panel render, open or collapsed, since
//                render(cx) only runs while open: use it to follow the space
//                so the collapsed summary stays true
import { Changes, key } from "./changes.js";
import { commits } from "./commits-section.js";
import { pullRequest } from "./pr-section.js";
import { myPrs } from "./prs-section.js";
import { changesSummary } from "./sections.js";

const changes = {
  id: "changes",
  label: "Changes",
  defaultOpen: true,
  fill: true,
  create(props, cx) {
    const part = new Changes();
    part.embedded = true;
    part.init(props, cx);
    return {
      sync: (cx) => { if (key() !== part.context) part.refresh(cx); },
      summary: () => changesSummary(part.files, part.error),
      render: (cx) => part.render(cx),
    };
  },
};

export const SECTIONS = [changes, pullRequest, myPrs, commits];
