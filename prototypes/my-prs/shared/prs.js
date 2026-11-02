// PROTOTYPE (issue #7, throwaway). Data + row drawing shared by proto-prs-panel and
// proto-prs-popup. Herdr refuses imports outside a mod's folder (symlinks too), so
// install.sh copies this file into both mods. Edit it here, then run install.sh.
//
// Data: one `gh api graphql` call, two aliased searches (author / review-requested),
// `--cache 60s` so both mods share one network call (research #4).

import { div } from "gpui-kit";
import { h_flex, v_flex } from "gpui-base";
import { exec, notify, readTextFile, shared, setShared, window, props, nextCommand } from "herdr";

// ---------------------------------------------------------------------------
// Demo modes. "real" is the default. The mode lives in shared state so the panel
// and the popup agree; `herdr-app do` cannot pass props to mod.open.
//   real            author:@me / review-requested:@me
//   fixture         canned data below, no network (PROTOTYPE FIXTURE)
//   live:<login>    the same searches for a busy public user (read-only)
// ---------------------------------------------------------------------------
export const MODES = ["real", "fixture", "live:williammartin"];
const MODE_KEY = "proto-prs.mode";
export const mode = () => shared(MODE_KEY) ?? "real";
export const nextMode = () => setShared(MODE_KEY, MODES[(MODES.indexOf(mode()) + 1) % MODES.length]);
export const setMode = (m) => setShared(MODE_KEY, m);
export const modeLabel = (m) => (m === "real" ? "" : m === "fixture" ? "DEMO · fixture data" : `DEMO · ${m.slice(5)}'s PRs (read-only)`);

const QUERY = `query MyPrs($mine: String!, $review: String!) {
  viewer { login }
  mine: search(type: ISSUE, query: $mine, first: 50) { issueCount nodes { ...Pr } }
  review: search(type: ISSUE, query: $review, first: 50) { issueCount nodes { ...Pr } }
  rateLimit { cost remaining resetAt }
}
fragment Pr on PullRequest {
  number title url isDraft reviewDecision updatedAt headRefName
  repository { nameWithOwner }
  author { login }
  commits(last: 1) { nodes { commit { statusCheckRollup { state } } } }
}`;

// -> { at, login, sections, error }
export async function load(m = mode()) {
  if (m === "fixture") return { at: Date.now(), login: "you", sections: (({ mine, review }) => group(mine, review))(FIXTURE()), error: null };
  const who = m.startsWith("live:") ? m.slice(5) : "@me";
  const base = "is:pr is:open archived:false sort:updated-desc";
  const args = ["api", "graphql", "--cache", "60s",
    "-f", `mine=${base} author:${who}`,
    "-f", `review=${base} review-requested:${who} -author:${who}`,
    "-f", `query=${QUERY}`];
  try {
    const r = await exec("gh", args);
    if (r.code !== 0) return { at: Date.now(), login: who, sections: null, error: (r.stderr || r.stdout).trim().split("\n")[0] };
    const d = JSON.parse(r.stdout).data;
    const flat = (n) => ({
      repo: n.repository.nameWithOwner, number: n.number, title: n.title, url: n.url,
      draft: n.isDraft, review: n.reviewDecision ?? null, updated: Date.parse(n.updatedAt),
      branch: n.headRefName, author: n.author?.login ?? "ghost",
      checks: n.commits?.nodes?.[0]?.commit?.statusCheckRollup?.state ?? null,
    });
    const login = m.startsWith("live:") ? who : d.viewer.login;
    return { at: Date.now(), login, sections: group(d.mine.nodes.map(flat), d.review.nodes.map(flat)), error: null, cost: d.rateLimit };
  } catch (e) {
    return { at: Date.now(), login: who, sections: null, error: String(e?.message ?? e) };
  }
}

// "Whose move" grouping (mrolafsson/herdr-github as UX reference).
export function group(mine, review) {
  const failing = (p) => p.checks === "FAILURE" || p.checks === "ERROR";
  const fix = mine.filter((p) => !p.draft && (failing(p) || p.review === "CHANGES_REQUESTED"));
  const wait = mine.filter((p) => !p.draft && !fix.includes(p));
  return [
    { id: "review", title: "Review requested", hint: "your move", rows: review },
    { id: "fix", title: "Mine — needs fixing", hint: "your move", rows: fix },
    { id: "wait", title: "Mine — waiting", hint: "their move", rows: wait },
    { id: "draft", title: "Drafts", hint: "", rows: mine.filter((p) => p.draft) },
  ];
}

// ---------------------------------------------------------------------------
// Glyphs
// ---------------------------------------------------------------------------
export function checks(t, s) {
  if (s === "SUCCESS") return { g: "✓", c: t.ansi2, tip: "checks passed" };
  if (s === "FAILURE" || s === "ERROR") return { g: "✗", c: t.ansi1, tip: "checks failing" };
  if (s === "PENDING" || s === "EXPECTED") return { g: "◌", c: t.ansi3, tip: "checks running" };
  return { g: "·", c: t.dim, tip: "no checks" };
}
export function review(t, r) {
  if (r === "APPROVED") return { label: "approved", c: t.ansi2 };
  if (r === "CHANGES_REQUESTED") return { label: "changes", c: t.ansi1 };
  if (r === "REVIEW_REQUIRED") return { label: "review", c: t.muted };
  return { label: "", c: t.dim };
}
export function ago(ms) {
  const s = (Date.now() - ms) / 1000;
  if (s < 60) return "now";
  if (s < 3600) return `${Math.max(1, Math.round(s / 60))}m`;
  if (s < 86400) return `${Math.round(s / 3600)}h`;
  if (s < 86400 * 60) return `${Math.round(s / 86400)}d`;
  return `${Math.round(s / 86400 / 30)}mo`;
}
export const since = (ms) => (ago(ms) === "now" ? "just now" : `${ago(ms)} ago`);
const shortRepo =(repo) => repo.split("/")[1] ?? repo;

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------
let opener = null; // cached: ["explorer.exe"] on WSL, ["wslview"] if installed, else xdg-open
async function pickOpener() {
  if (opener) return opener;
  const which = await exec("sh", ["-c", "command -v wslview || true"]);
  if (which.stdout.trim()) return (opener = { cmd: "wslview", why: "wslview" });
  const v = (await readTextFile("/proc/version")) ?? "";
  if (/microsoft/i.test(v)) return (opener = { cmd: "explorer.exe", why: "WSL: Windows default browser" });
  return (opener = { cmd: "xdg-open", why: "xdg-open" });
}

// explorer.exe exits 1 even when it opened the URL; xdg-open (Linux Chrome under
// WSLg) blocks until the browser quits when none was running, so it is detached.
export async function openUrl(url) {
  const o = await pickOpener();
  if (o.cmd === "xdg-open") await exec("sh", ["-c", 'setsid xdg-open "$1" >/dev/null 2>&1 &', "sh", url]);
  else await exec(o.cmd, [url]);
}

// Stub: says what "open as worktree space" would do, does nothing.
export function worktreeStub(p) {
  notify({
    title: `Would open ${shortRepo(p.repo)}#${p.number} as a worktree space`,
    body: `Find a local checkout of ${p.repo} (a space whose repo matches, else ~/dev/${shortRepo(p.repo)}), `
      + `then: a space already on ${p.branch} → space.select; else git fetch origin ${p.branch} + `
      + `worktree mod {branch: "${p.branch}"} → ~/.herdr/worktrees/${shortRepo(p.repo)}/${p.branch.replace(/[^A-Za-z0-9._-]+/g, "-")}. `
      + `No repo clone found → offer gh repo clone. (PROTOTYPE stub, nothing ran.)`,
    level: "info",
    timeout: 9000,
  });
}

// ---------------------------------------------------------------------------
// Drawing
// ---------------------------------------------------------------------------

// A section heading: title, count, whose move.
export function heading(t, s, { compact } = {}) {
  return h_flex().px(compact ? 10 : 12).pt(10).pb(3).gap(6).items_center()
    .text_size(11).font_semibold().text_color(s.id === "review" || s.id === "fix" ? t.foreground : t.muted)
    .child(div().child(s.title.toUpperCase()))
    .child(div().text_color(t.dim).child(String(s.rows.length)))
    .child(div().flex_1())
    .when(Boolean(s.hint), (el) => el.child(div().font_medium().text_color(t.dim).child(s.hint)));
}

// One PR. compact: two lines for a narrow column (repo#n · age / title), else one
// line (repo#n  title ......  ✓ approved 3h). `selected` draws the keyboard cursor.
export function row(t, p, { compact, selected, showAuthor, id, onOpen, onWorktree }) {
  const ck = checks(t, p.checks);
  const rv = review(t, p.review);
  const wt = div().id(`${id}-wt`).flex_none().px(5).rounded(4).text_size(11).text_color(t.dim)
    .hover((s) => s.bg(t.selected).text_color(t.foreground))
    .tooltip("Open as worktree space (stub)")
    .on_mouse_down("left", (_e, cx) => cx.stop_propagation())
    .on_click((_e, cx) => { cx.stop_propagation(); onWorktree(p); })
    .child("⎇");
  const ref = div().flex_none().text_color(t.muted).child(`${shortRepo(p.repo)}#${p.number}`);
  const base = (compact ? v_flex().gap(1).py(5) : h_flex().gap(8).py(6).items_center())
    .id(id).px(compact ? 10 : 12).mx(compact ? 4 : 6).rounded(6).text_size(12.5)
    .bg(selected ? t.selected : "#00000000")
    .hover((s) => s.bg(selected ? t.selected : t.hover))
    .tooltip(`${p.repo}#${p.number} · ${p.branch}${showAuthor ? ` · by ${p.author}` : ""}\n${p.url}`)
    .on_click(() => onOpen(p));
  if (compact) {
    return base
      .child(h_flex().gap(6).items_center().text_size(11)
        .child(div().flex_none().w(12).text_color(ck.c).child(ck.g))
        .child(ref)
        .when(showAuthor, (el) => el.child(div().flex_none().text_color(t.dim).child(`@${p.author}`)))
        .child(div().flex_1())
        .when(Boolean(rv.label), (el) => el.child(div().flex_none().text_color(rv.c).child(rv.label)))
        .child(div().flex_none().text_color(t.dim).child(ago(p.updated)))
        .child(wt))
      .child(div().pl(18).text_color(t.foreground).truncate().child(p.title));
  }
  return base
    .child(div().flex_none().w(14).text_color(ck.c).child(ck.g))
    .child(ref.w(150).truncate())
    .child(div().flex_1().min_w(0).truncate().text_color(t.foreground).child(p.title))
    .when(showAuthor, (el) => el.child(div().flex_none().text_size(11).text_color(t.dim).child(`@${p.author}`)))
    .child(div().flex_none().w(64).text_size(11).text_color(rv.c).child(rv.label))
    .child(div().flex_none().w(30).text_size(11).text_color(t.dim).child(ago(p.updated)))
    .child(wt);
}

// Nothing open: says what was searched, so empty reads as "checked", not "broken".
export function empty(t, data, { compact } = {}) {
  return v_flex().items_center().gap(6).px(16).py(compact ? 24 : 36)
    .child(div().text_size(22).text_color(t.ansi2).child("✓"))
    .child(div().text_size(13).font_semibold().text_color(t.foreground).child("Nothing waiting on you"))
    .child(div().text_size(11.5).text_color(t.muted).child(`No open PRs by ${data.login} and no review requests.`))
    .child(div().text_size(11).text_color(t.dim).child(`searched all of github.com · ${since(data.at)}`));
}

export function failure(t, data) {
  return v_flex().gap(6).px(14).py(20)
    .child(div().text_size(13).font_semibold().text_color(t.ansi1).child("Couldn't ask GitHub"))
    .child(div().text_size(11.5).text_color(t.muted).child(data.error))
    .child(div().text_size(11).text_color(t.dim).child("gh auth status · gh api graphql -f query='{viewer{login}}'"));
}

// ---------------------------------------------------------------------------
// PROTOTYPE FIXTURE: invented PRs covering every section and glyph. Not real.
// ---------------------------------------------------------------------------
function FIXTURE() {
  const h = 3600e3, now = Date.now();
  const pr = (repo, number, title, o) => ({
    repo, number, title, url: `https://github.com/${repo}/pull/${number}`, draft: false, review: null,
    checks: "SUCCESS", updated: now - h, branch: `feat/${number}`, author: "you", ...o,
  });
  return {
    mine: [
      pr("florianPalabost/lara-vision", 104, "Show bourse news on the dashboard card", { checks: "FAILURE", review: "REVIEW_REQUIRED", updated: now - 0.4 * h }),
      pr("florianPalabost/ai-setup", 12, "feat: version the herdr config in install and snapshot", { review: "CHANGES_REQUESTED", updated: now - 5 * h }),
      pr("acme/billing-api", 881, "Retry webhooks with exponential backoff and jitter", { checks: "PENDING", review: "REVIEW_REQUIRED", updated: now - 2 * h }),
      pr("florianPalabost/lara-vision", 101, "Upgrade Inertia to v2 and fix the deferred props", { review: "APPROVED", updated: now - 26 * h }),
      pr("acme/web", 3302, "Cache the pricing table per locale", { checks: null, updated: now - 9 * 24 * h }),
      pr("florianPalabost/ai-setup", 14, "wip: git graph mod from the herdr-git-graph recipe", { draft: true, checks: "PENDING", updated: now - 50 * h }),
    ],
    review: [
      pr("acme/web", 3311, "Move checkout to the new payment intents flow", { author: "marie-l", review: "REVIEW_REQUIRED", checks: "SUCCESS", updated: now - 0.2 * h }),
      pr("acme/billing-api", 879, "Drop the legacy invoice exporter", { author: "tomk", review: "REVIEW_REQUIRED", checks: "FAILURE", updated: now - 30 * h }),
      pr("laravel/framework", 55120, "[12.x] Allow closures in Rule::when for nested arrays", { author: "a-contributor", review: null, checks: "PENDING", updated: now - 4 * 24 * h }),
    ],
  };
}

// ---------------------------------------------------------------------------
// Refresh policy (research #4): on open, on mode switch, when the window comes
// back to the front with data > 2 min old, and every 5 min while it is in front.
// One 15 s tick decides.
// ---------------------------------------------------------------------------
export class Feed {
  constructor(cx) {
    // props {mode} (tab.new / pane.split) picks the demo mode for both mods.
    const want = props()?.mode;
    if (want && want !== mode()) setMode(want);
    this.data = null;
    this.busy = false;
    this.shownMode = mode();
    this.wasActive = true;
    this.reload(cx);
    cx.timer.every(15000, (cx) => this.tick(cx));
    // `herdr-app do <mod>.demo` / `.refresh` (only shown copies get them).
    cx.spawn(async (cx) => {
      for (;;) {
        const c = await nextCommand();
        if (c === "demo") { nextMode(); this.shownMode = mode(); }
        if (c === "demo" || c === "refresh") this.reload(cx);
      }
    });
  }
  tick(cx) {
    const age = this.data ? Date.now() - this.data.at : Infinity;
    const active = window().active;
    const back = active && !this.wasActive;
    this.wasActive = active;
    if (active && ((back && age > 120e3) || age > 300e3)) this.reload(cx);
  }
  // Called from render: a mode switch in the other mod reaches this one too.
  follow(cx) {
    if (mode() !== this.shownMode) { this.shownMode = mode(); this.reload(cx); }
  }
  reload(cx) {
    if (this.busy) return;
    this.busy = true;
    const m = mode();
    if (this.data?.mode !== m) this.data = null; // don't show the old mode's rows under the new label
    cx.spawn(async (cx) => {
      const d = await load(m);
      this.busy = false;
      // The mode changed while asking: drop this answer and ask again.
      if (mode() !== m) return this.reload(cx);
      this.data = { ...d, mode: m };
      cx.notify();
    });
  }
  count() {
    return (this.data?.sections ?? []).reduce((n, s) => n + s.rows.length, 0);
  }
}
