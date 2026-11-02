# PROTOTYPE: my PRs and review requests (#7)

Throwaway. Built to support the grilling on [#7](https://github.com/florianPalabost/ai-setup/issues/7) (map #2), not a decision. Two placements of the same list, as herdr-app 0.1.11 mods:

- `proto-prs-panel`: a sidebar-style panel, opened as a pane or a tab. Below 420 px it draws two-line rows, wider it draws one line per PR.
- `proto-prs-popup`: a palette-style popup at the top of the window (`mod.json` `overlay: popup`, 760 px × 70 %), with keyboard navigation.

Both show the same sections: **Review requested** (your move), **Mine — needs fixing** (failing checks or changes requested, your move), **Mine — waiting** (their move), **Drafts**. Empty sections are hidden. Each row shows the checks glyph (✓ ✗ ◌ ·), `repo#number`, the title, the author (review requests only), the review state (approved / changes / review), the age since the last update and a ⎇ button.

## Install and open

```sh
prototypes/my-prs/install.sh    # copies both mods + shared/prs.js into ~/.config/herdr-app/mods, runs herdr-app check

# panel, beside the focused terminal
herdr-app do pane.split '{"direction":"right","mod":"proto-prs-panel"}'
# panel, as its own tab
herdr-app do tab.new '{"name":"prs","mod":"proto-prs-panel"}'
# popup (run again to close it; Esc closes it too). No key is bound.
herdr-app do mod.open '{"name":"proto-prs-popup"}'

# remove
rm -rf ~/.config/herdr-app/mods/proto-prs-panel ~/.config/herdr-app/mods/proto-prs-popup
```

Popup keys: ↑/↓ choose, Enter opens in the browser and closes, `w` runs the worktree stub, `r` refreshes, `m` switches the demo mode, Esc closes.

## Demo mode

You have no open PRs and no review requests, so the default (real) view is the empty state. To judge the UI with data, switch the mode. The mode is shared by both mods (shared key `proto-prs.mode`) and a yellow **DEMO** banner shows it:

| Mode | What it shows |
|---|---|
| `real` (default) | `author:@me` / `review-requested:@me` |
| `fixture` | 9 invented PRs covering every section and glyph, no network (`FIXTURE()` in `shared/prs.js`) |
| `live:williammartin` | the same searches for a busy public user (read-only): 12 of his own PRs (1 to fix, 7 waiting, 4 drafts) and 50 review requests (the cap) |

Ways to switch: the **demo** button in the panel header, `m` in the popup, `herdr-app do proto-prs-panel.demo` / `proto-prs-popup.demo` (only while one is shown), or open the panel with props: `herdr-app do tab.new '{"mod":"proto-prs-panel","props":{"mode":"fixture"}}'`. The props are applied again on every hot reload. Switch back to `real` when you're done.

## What it calls

- **GitHub:** one `gh api graphql --cache 60s` call with two aliased searches (`is:pr is:open archived:false sort:updated-desc author:<who>` and `... review-requested:<who> -author:<who>`), first 50 each, with checks rollup `state`, `reviewDecision`, `isDraft`, `headRefName`. Cost 1 point. This follows research #4.
- **Refresh:** on open, on a mode switch, when the window comes back to the front with data older than 2 min, and every 5 min while the window is in front (one 15 s tick decides). ↻ / `r` refresh by hand.
- **Open in browser:** `wslview` if installed (it isn't here), else on WSL `explorer.exe <url>` (the Windows default browser; it exits 1 even when it worked), else `setsid xdg-open` detached. On this machine, `xdg-open` opens the Linux Chrome under WSLg and **blocks until that browser quits** when none was running, which would hold an `exec` (30 s limit), so it runs detached.
- **Open as worktree space:** a stub. It posts a toast that describes what it would do: find a local checkout of the repo, `space.select` a space already on that branch, or `git fetch` + the shipped `worktree` mod with `{branch}`, or offer `gh repo clone` when no checkout exists.

## Files

- `shared/prs.js`: data, grouping, glyphs, row drawing, opener, worktree stub, fixture, refresh policy. Herdr refuses imports from outside a mod's folder (symlinks too: "resolves outside the application directory"), so `install.sh` copies it into each mod.
- `proto-prs-panel/`, `proto-prs-popup/`: `main.js` + `mod.json` (`"place": "none"`).
- `shots/`: screenshots from the running app (fixture narrow panel, fixture popup, real empty popup, live panel).

## Gaps (on purpose, or not checked)

- No filter or search box, no repo scoping, no sorting choice: always "updated, newest first" within a section.
- `review-requested:` includes team requests. For williammartin that is 205 requests (capped at 50), mostly bot PRs. `user-review-requested:` only counts direct ones (research #4). The prototype doesn't separate them.
- The "needs fixing" rule is crude: failing checks or changes requested. It doesn't look at merge conflicts (`mergeStateStatus`), unresolved threads or "approved and green = ready to merge" (mrolafsson has a separate section for that).
- No "already open locally" marker (a space or worktree on that branch).
- The worktree action is only a toast.
- Clicking a row was tested with `explorer.exe` from a shell, not by clicking inside Herdr (`herdr-app` can't click). The fixture URLs are invented and will 404.
- The panel can only live in a pane or a tab here. A real sidebar slot needs a layout edit (`layout.clone`), which this prototype doesn't touch.
- No badge or count anywhere else (status bar, tab bar).
