# PROTOTYPE: git graph for herdr (wayfinder #5)

Throwaway code for issue #5, "Git graph: native pane vs TUI" (map #2). It
compares three ways to show a git graph in herdr-app 0.1.11. **Not a
decision, and not production code.** Built and tried on Linux/WSL2.

Each folder is a herdr mod. Copy it to `~/.config/herdr-app/mods/<name>/` to
try it. Every `mod.json` uses `"place": "none"`, so nothing docks into your
layout. To remove a mod, delete its folder.

| Variant | What it is | Opens with |
|---|---|---|
| `proto-graph-community` | `rabeeh-ta/herdr-git-graph` v0.2.0 (commit `b70e795`, MIT), renamed | a tab or pane |
| `proto-graph-tui` | `git log --graph … \| less -RS` in a terminal pane | `mod.open`, or a plain `terminal.open` |
| `proto-graph-native-mini` | about 130 lines written from scratch: lanes plus click to `git show` | a tab or pane |

## How to open each

Replace `/path/to/repo` with a repository. Leave `props` out to use the
focused pane's folder.

```sh
# 1. community: as a tab, or split next to the focused pane
herdr-app do tab.new '{"name":"graph","mod":"proto-graph-community","props":{"folder":"/path/to/repo"}}'
herdr-app do pane.split '{"direction":"right","mod":"proto-graph-community","props":{"folder":"/path/to/repo"}}'

# 2. tui: a terminal opens right of the focused pane, in that pane's folder
herdr-app do mod.open '{"name":"proto-graph-tui"}'
#    or without any mod:
herdr-app do terminal.open '{"place":"right","folder":"/path/to/repo","argv":["sh","-c","git log --graph --oneline --decorate --all --color=always | less -RS"]}'

# 3. native-mini
herdr-app do tab.new '{"name":"mini","mod":"proto-graph-native-mini","props":{"folder":"/path/to/repo"}}'
```

## What each one does, and what it can change

### proto-graph-community

- VS Code Git Graph clone. It shows colored lanes, branch, remote and tag
  labels, HEAD as a ring, and uncommitted changes as a dashed row. You can
  switch between all branches and the current one, and turn remotes on or off.
  The columns resize. Clicking a commit opens its details and files, and
  clicking a file shows its diff. It loads 300 commits per page and stays live
  through `watchFolder` plus a 15 s timer.
- **What it can change (kept from upstream).** Double-clicking a branch label
  checks it out without asking. The Fetch button runs `git fetch --all`. The
  right-click menus offer checkout, rename and delete branch, merge, rebase,
  cherry-pick, revert, reset (soft, mixed or hard), add tag, create branch,
  push, push tag, delete remote branch, stash and reset uncommitted. Each of
  these asks first in a dialog. Network access goes only through `git` (fetch,
  push, delete remote).
- **Changes from upstream:**
  - Every self-reference (`git-graph` as the mod name, its `mods/…/icons`
    paths, its shared-state keys) is renamed to `proto-graph-community`.
  - The update check is off: `CHECK = false`, and the `fetch` to
    `api.github.com` is deleted, so the mod makes no requests of its own.
  - There was no macOS `open` to replace: the only URL opener is
    `cx.open_url` in the update window, which can no longer open.
  - The upstream LICENSE is kept.
- "Show in Changes" assumes the `main` layout's `panel` and `panel-body` ids.

### proto-graph-tui

- Plain `git log --graph --oneline --decorate --all --color=always`, paged
  by `less -RS`. Press `q` to quit, which closes the pane. `/` searches.
- Read-only. It doesn't refresh: reopen it to see new commits. Clicking does
  nothing, and there is no commit detail view. lazygit and tig aren't installed,
  so this is the bare-git version of the "TUI" option.
- `mod.open` reads `focused().cwd`, runs `terminal.open` to the right, and
  closes its overlay. Opened as a tab, it shows a button that does the same.

### proto-graph-native-mini

- One `git log --all --date-order -n500` read when it opens or on Refresh. A
  greedy lane layout of about 25 lines, drawn with `paint_path` in a
  `v_virtual_list`. Refs appear as raw `%D` text. The header shows git and
  layout timings. Clicking a commit opens `git show --stat --patch | less -RS`
  in a terminal to the right: a native list with TUI details.
- Read-only. Missing: live refresh, paging, separate labels per ref, a
  details pane, the uncommitted row, the current-branch scope, and a cap on
  lane width.

## First observations (not a decision)

Timings come from a script that runs the same git commands, outside herdr.
The UI results come from screenshots.

| Repo | Commits / refs | community `log -n301` | tui first screen / full | mini (in herdr) |
|---|---|---|---|---|
| `~/dev/ai-setup` | ~40 | instant | instant | git 36 ms, 2 lanes |
| `~/dev/lara-vision` (the biggest in `~/dev`) | 512 / 41 | 20 ms | 20 ms / 18 ms | n/a |
| `git/git` blobless clone, no commit-graph file | 85,966 / 1,022 | 834 ms | 653 ms / 1.4 s | git 847 ms, layout 35 ms, **136 lanes** |

- **community** works on Linux/0.1.11 as is, and `herdr-app check` passes. On
  ai-setup and lara-vision it looks polished: worktree branches, remotes and
  HEAD are all labeled. **On git/git the table stayed blank**: the header and
  columns drew, but no rows, even after 20 s, and `herdr-app status` showed no
  error. With 136 lanes in the first 300 commits, the graph column is capped at
  40 % of the width. The cause isn't diagnosed. mini drew the same 136 lanes
  without trouble, so `paint_path` itself copes.
- **tui** costs almost nothing to build or maintain, and it's fast and honest.
  But it has no clicks, no live refresh, and it truncates long lines (`-S`).
  Its value is "glance at the shape". It's no better than typing the command
  into a pane.
- **native-mini**: a usable lane view took about 130 lines and under an hour,
  passed `check` the first time, and handled the big repo (35 ms layout). The
  community mod's ~1,400 lines buy the rest: labels with hit-testing,
  details and diff, live refresh, paging, write actions, and caching across
  folders. On a merge-heavy repo, both native views become a wall of lanes. A
  real build would need a lane cap or a "first-parent" toggle.
- Read speed depends on git, not herdr. Without a commit-graph file,
  `--date-order` walks the whole history (about 0.8 s on git/git), and
  `git commit-graph write --reachable` is the documented fix.
