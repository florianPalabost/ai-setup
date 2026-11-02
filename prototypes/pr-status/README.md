# PROTOTYPE: PR + checks for the current branch (wayfinder #6)

Throwaway code for issue #6 (map #2). It shows the same data in two placements so they can be compared in the running herdr-app. It is not a decision and not a spec.

Data shown: PR number and title, state (Open / Draft / Merged / Closed), review decision, merge state, and checks counted as failing, pending, passing and skipped. It also covers "no PR", "no GitHub remote", "not a git repository", "detached HEAD" and "space on another machine".

## Install and open

```sh
sh prototypes/pr-status/install.sh        # copies both mods + pr-data.js into ~/.config/herdr-app/mods, runs herdr-app check
```

Both `mod.json` files use `"place": "none"`, so nothing appears until you open it:

```sh
# 1. The strip, as a pane under the focused terminal (in a real layout it would be a { px: 32 } block)
herdr-app do pane.split '{"direction":"down","mod":"proto-pr-strip"}'
# 2. The detail pane, beside it
herdr-app do pane.split '{"direction":"right","mod":"proto-pr-pane"}'
# 2b. The same pane as a popup (its mod.json has an overlay spec; run again to close)
herdr-app do mod.open '{"name":"proto-pr-pane"}'
# or as a tab of its own (it then reads the space's folder, see Gaps)
herdr-app do tab.new '{"mod":"proto-pr-pane"}'
```

Remove: `rm -rf ~/.config/herdr-app/mods/proto-pr-strip ~/.config/herdr-app/mods/proto-pr-pane`.

## The two placements

| | `proto-pr-strip` | `proto-pr-pane` |
|---|---|---|
| Shape | One 32 px row: `repo · branch`, `#N title`, state chip, review, `conflicts` if DIRTY, `✗ ✓ ◌ ⊘` counts, `↻` | Header (repo · branch, `#N title`, state, review, merge state), count summary, failing + pending checks list (passing/skipped behind a toggle), buttons, a footer showing when it last checked |
| Click `#N title` | Opens the PR in the browser | Same |
| Second click target | The counts open `proto-pr-pane` as a popup | Each check row opens its details URL. There are also "Open on GitHub" and "Checks tab" buttons |
| No PR | `No PR for <branch>` + `Create PR ↗` (the GitHub compare page) | Same, as a button |

## What it calls

`pr-data.js` (each mod folder gets its own copy, because a mod imports only from its folder):

1. **Location:** the focused terminal pane's cwd and branch. If a mod pane has focus, it uses the tab's first terminal pane, then `space.folder`. This is the shipped `changes` mod's `location()`, plus the branch.
2. **Local git** (no network): `rev-parse --show-toplevel --abbrev-ref HEAD`, `remote -v`, `config --get branch.<b>.remote`. The branch's push remote (default `origin`) gives the head owner. `upstream`, when it's a GitHub remote, is the repo that gets queried (fork workflow). Only `github.com` URLs count (https, `git@github.com:`, `ssh://`).
3. **One `gh api graphql` call** (cost 1): `repository.pullRequests(headRefName:, states: OPEN/MERGED/CLOSED)` with `statusCheckRollup.contexts(first: 100)`. Results are filtered to `headRepositoryOwner == push remote owner` (to drop forks with the same branch name). OPEN is preferred, then the most recently updated.
4. **Open URL:** `wslview` if installed, else `explorer.exe` on WSL, else `setsid xdg-open` (detached). Set `OPENER` at the top of `pr-data.js` to compare.

## Refresh behaviour

There is a 2 s tick that only decides whether a refresh is due, as the `spaces` mod does. A refresh happens when:
- **The place or branch changes** (a cd, `git switch`, another pane or space): fetched right away, no gh cache.
- **A terminal in the shown space goes busy → idle** (after `git push` or `gh pr create`): no gh cache.
- **The window becomes active again** and the data is older than the interval.
- **Timer**, only while `window().active` and a PR exists: every 60 s while any check is pending, 5 min otherwise. It uses `gh api --cache 30s`.
- **↻ click:** no cache.
- `cx.notify()` runs only when the result changed.

## Tested (2026-11-02, herdr-app 0.1.11, WSL2)

No open PR of mine exists, so the fixtures are empty git repos in the scratchpad with a matching branch name and `origin` (no clone needed):

| Fixture | Result |
|---|---|
| `astral-sh/uv` `renovate/libc-0.x-lockfile` | #23046 Open, no review rules, Blocked, ✗2 ✓54 ⊘16. The two failing checks are listed (the newer OPEN PR wins over an older MERGED one with the same branch). |
| `cli/cli` `williammartin-global-feature-flags` (ssh remote) | #14781 Draft, Review required, Blocked, ✓11 ⊘7 |
| `florianPalabost/lara-vision` `feat/bourse-news` | #98 Merged, ✓3 |
| `cli/cli` with a nonexistent branch | `No PR for …` + Create PR |
| origin on gitlab.com | `No GitHub remote (origin: https://gitlab.com/…)` |
| folder outside git | `Not a git repository` |

One gh call took 0.8 to 1.4 s. `herdr-app check` passes for both mods.

**Opening URLs on this machine:** `wslview` is not installed. `xdg-open` works, but it opens **Linux** Chrome under WSLg (`com.google.Chrome.desktop`), not the Windows browser where you're signed in. It also blocks until Chrome exits, so it must be detached, or `exec`'s 30 s limit kills it. `explorer.exe <url>` hands the URL to the Windows default browser, but always exits 1, so its exit code says nothing. The prototype uses `explorer.exe`. Clicking was not tested from the CLI: please click the title once to confirm it opens the right browser.

## Gaps (prototype, on purpose)

- Every mod copy runs its own watcher. Strip + pane + popup = 3 gh calls on each context change, because those refreshes skip the cache so a fresh push is seen. A real build would share one result, either through `setShared` or one mod that owns the data.
- On a cd, the UI resets to "Looking for a PR…" for about 1 s instead of keeping the old row dimmed.
- The pending path (spinner glyphs, 60 s cadence) was not seen live: no fixture had running CI at test time.
- A mod-only tab has no terminal pane, so it falls back to `space.folder` (where the space was made, not where you cd'd).
- Not covered: review threads, required vs optional checks, failed-log tail, re-run, merge. Checks are capped at 100 (the cap is shown as "first N of M"). Remote-machine spaces are skipped. A push remote under an ssh host alias (`github-work:`) shows as "no GitHub remote".
- The strip in a pane draws filler text below the 32 px row. Seeing it as a real bar needs a cloned layout (not done: layouts are off-limits for this prototype).

## Note (not built): a badge in a cloned `spaces` sidebar

What it would take:
1. `herdr-app do mod.clone '{"name":"spaces","as":"my-spaces"}'` and `layout.clone` main → a personal layout whose `sidebar` block points at `my-spaces`. Clones never get Herdr's updates to `spaces` (379 lines today), so every herdr-app release means re-diffing by hand.
2. PR data **per space**, not just the shown one: one lookup per distinct (repo, branch) in the list. Either N GraphQL calls, or one batched query with an alias per repo/branch (still cost 1 to 2). It would hook into `spaces`' existing `due()` (new place, busy → idle, 60 s fallback) instead of its own tick.
3. Room for it: the row tail already holds repo · branch · ↑↓. A one-glyph badge (`✓ ✗ ◌` coloured, or `#N`) fits, and anything wider needs the second line that `munza/better-spaces` adds. The click target would be the glyph (open PR, or open this pane as a popup) without stealing the row's space.select click.
4. This is what `natelandau/herdr-worktree-support` and `munza/better-spaces` do (see the research on #3). The map prefers not cloning shipped mods unless the feature must live inside them.
