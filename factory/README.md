# factory

Runs GitHub tickets through Claude, one at a time: implement, check, review, rework, then a draft PR. Install links it into `~/.local/bin`. Run `factory` from inside a repo, or pass `--repo <path>`.

## Commands

| Command | What it does |
| --- | --- |
| `factory doctor` | Checks `git`, `gh`, `claude`, the sandbox tools, `gh auth` and the repo's `.factory.json`, and prints the install command for what's missing |
| `factory init` | Creates the `agent-working` and `agent-done` labels in the repo |
| `factory status [--json] [--local]` | Lists the tickets the factory tracks, with their PR, blockers, worktree and latest run. `--local` reads only the runs under `.git/factory` and makes no GitHub calls |
| `factory run <issue>` | Runs one ticket |
| `factory next` | Runs the oldest `ready-for-agent` ticket with no open blocker |
| `factory watch <issue>` | Follows the ticket's latest run: each step, and the agent's transcript as readable lines. Stops when the run ends |
| `factory resume <issue> [--step <name>]` | Opens an interactive Claude on the last coding step's session (or `--step`), in the ticket's worktree. Refused while the run goes on, unless you pass `--force` |
| `factory log <issue> [--step <name>] [--json]` | Writes the latest run as `run.md` (steps, timing, cost, messages, tool calls, review findings) and prints its path |
| `factory clean [--dry-run] [--json]` | Removes the worktree and branch of each ticket whose PR is merged, unless it has uncommitted changes or commits after the merge. `run` and `next` do this first |

`run` and `next` take `--dry-run` (no GitHub writes, no agents), `--no-sandbox` (Claude runs without `srt`) and `--force` (take over a ticket already labelled `agent-working`).

## A run

1. Labels the ticket `agent-working` and creates its worktree at `<repo>-factory/issue-<n>` on the branch `agent/issue-<n>`, from `origin/<baseBranch>`. If that worktree already exists, the run carries on in it.
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
  "models": { "implement": "opus", "review": "sonnet", "pr": "sonnet" },
  "permissionMode": "auto",
  "maxReworks": 2,
  "agentTimeoutMinutes": 60,
  "sandbox": { "allowWrite": [], "denyRead": [] }
}
```

`setup` and `checks` are shell commands run in the worktree. `permissionMode: "bypassPermissions"` is refused with `--no-sandbox`. `sandbox` adds paths to what `srt` lets the agents write and keeps them from reading.

## Where to see it

The Factory tab in herdr (`herdr/mods/factory-board`) shows these tickets as a kanban, with Watch, Resume and Log buttons. The Run graph tab (`herdr/mods/orch-graph`) draws a ticket's latest run as a graph of its steps.
