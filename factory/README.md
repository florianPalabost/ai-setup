# factory

Runs GitHub tickets through Claude, one at a time: implement, check, review, rework, then a draft PR. Install links it into `~/.local/bin`. Run `factory` from inside a repo, or pass `--repo <path>`.

## Commands

| Command | What it does |
| --- | --- |
| `factory doctor` | Checks `git`, `gh`, `claude`, the sandbox tools, that `bwrap` can create a sandbox on Linux, `gh auth` and the repo's `.factory.json`, and prints the install command for what's missing, or the AppArmor fix when Ubuntu blocks `bwrap` |
| `factory init` | Creates the `agent-working` and `agent-done` labels in the repo |
| `factory status [--json] [--local]` | Lists the tickets the factory tracks, with their PR, blockers, worktree and latest run, under a line naming the checkout that has the stack (`stack: #39 (since 14:02)`; the `stack` key with `--json`, `--local` included). `--local` reads only the runs under `.git/factory` and makes no GitHub calls. With `--json`, GitHub's answer comes from one GraphQL call and is reused for a minute (gh's cache), so the boards polling it share it; `--fresh` asks GitHub again |
| `factory run <issue>` | Runs one ticket |
| `factory next` | Runs the oldest `ready-for-agent` ticket with no open blocker |
| `factory watch <issue>` | Follows the ticket's latest run: each step, and the agent's transcript as readable lines. Stops when the run ends |
| `factory resume <issue> [--step <name>]` | Opens an interactive Claude on the last coding step's session (or `--step`), in the ticket's worktree. Refused while the run goes on, unless you pass `--force` |
| `factory log <issue> [--step <name>] [--json]` | Writes the latest run as `run.md` (steps, timing, cost, messages, tool calls, review findings) and prints its path |
| `factory clean [--dry-run] [--json]` | Removes the worktree and branch of each ticket whose PR is merged, unless it has uncommitted changes, commits after the merge, or the stack (kept with the reason `stack is up`). `run` and `next` do this first |
| `factory up <issue> [--no-serve] [--force]` | Moves the repo's stack to the ticket's worktree: runs `down` where the stack is up, `up` in the worktree, then `serve` in the foreground. See [The stack](#the-stack) |
| `factory up --main [--no-serve] [--force]` | The same for the main checkout, to switch back |
| `factory down` | Runs `down` where the stack is up and forgets where it was |

`run` and `next` take `--dry-run` (no GitHub writes, no agents), `--no-sandbox` (Claude runs without `srt`) and `--force` (take over a ticket already labelled `agent-working`).

## A run

1. Checks that git can reach `origin`, so ssh asks for your key passphrase now rather than at the push. Then labels the ticket `agent-working` and creates its worktree at `<repo>-factory/issue-<n>` on the branch `agent/issue-<n>`, from `origin/<baseBranch>`. If that worktree already exists, the run carries on in it.
2. On a new worktree, runs the `setup` commands.
3. **implement**: Claude runs `/implement` on the ticket. With no commits, the ticket goes to `ready-for-human`.
4. **checks**: runs the `checks` commands. **review**: if they pass, `/matt-code-review` runs read-only. On a failure, **rework** sends the findings back to the implementing model, at most `maxReworks` times.
5. Pushes the branch, writes the PR body with `/pr` and opens a draft PR, or updates the one already open.
6. Comments on the ticket and labels it `agent-done` when the review passed, otherwise `ready-for-human`. A run that stops on an error also goes to `ready-for-human`, and its worktree is kept.

Each run writes to `.git/factory/issue-<n>/<timestamp>/`: `progress.jsonl` (step changes, read by `status`, `watch` and the boards), one stream-json transcript per agent step, and `watch.log` (what `watch` prints, as plain text, written while the run goes). A run whose process died before it finished reads as `abandoned`.

## `.factory.json`

Optional, at the repo root. Every key falls back to the default shown.

```json
{
  "baseBranch": "main",
  "setup": [],
  "checks": [],
  "up": [],
  "down": [],
  "serve": "",
  "models": { "implement": "opus", "review": "sonnet", "pr": "sonnet" },
  "permissionMode": "auto",
  "maxReworks": 2,
  "agentTimeoutMinutes": 60,
  "checkTimeoutMinutes": 20,
  "sandbox": { "allowWrite": [], "denyRead": [] }
}
```

`setup` and `checks` are shell commands run in the worktree. A check still running after `checkTimeoutMinutes` is killed, with everything it started, and counts as failing. `permissionMode: "bypassPermissions"` is refused with `--no-sandbox`. `sandbox` adds paths to what `srt` lets the agents write and keeps them from reading.

## The stack

Some repos can run their app from one checkout at a time: fixed container names and ports, one shared database. `up`, `down` and `serve` let `factory up` move that single stack between the main checkout and the tickets' worktrees, to try a feature by hand:

```json
{
  "up": ["make up", "make migrate"],
  "down": ["make down"],
  "serve": "npm run dev"
}
```

- `up`: shell commands that start the stack and finish. `down`: the ones that stop it. Both are needed by `factory up`, which otherwise stops with `stack_not_configured`.
- `serve`: one long-running command, run in the foreground after `up`. Ctrl+C stops `serve` only; the stack keeps running until `factory down`. `--no-serve` skips it.

`.git/factory/stack.json` records the checkout that has the stack (`{ "checkout": "main" | <issue>, "path", "since" }`), and is the only source factory trusts: it never asks Docker. With no record, the stack is taken to be in the main checkout. When the recorded worktree is gone, `down` runs from the main checkout, after a warning.

`factory up`:

1. Refuses with `no_worktree` when the ticket has no worktree, and warns (without refusing) when a run is working in it.
2. Runs `down` where the stack is, unless it is already in that checkout. A failing `down` stops it with `command_failed` and leaves `stack.json` as it was; `--force` carries on.
3. Records the new checkout in `stack.json`, then runs `up` there. A failing `up` command stops it, and `factory down` cleans up.
4. Runs `serve`.

`factory doctor` checks that `up` and `down` are both set or both empty, and that `serve` isn't set without `up`.

## Where to see it

The Factory tab in herdr (`herdr/mods/factory-board`) shows these tickets as a kanban, with Watch, Resume and Log buttons. With the Bottom panel installed, Watch follows the run's `watch.log` in its Output tab instead of a terminal. A Start button on a ready, unblocked ticket or one that needs you runs `factory run` for it in a new terminal tab. The Run graph tab (`herdr/mods/orch-graph`) draws a ticket's latest run as a graph of its steps.
