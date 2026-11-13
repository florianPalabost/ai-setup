# Orchestration Graph

A read-only Orca plugin that draws an orchestration run's tasks as a graph: one card per task, coloured by status, with the agent working on it, open decision gates, and arrows from each dependency to the task waiting on it.

- **Sidebar:** the "Run graph" panel in the right sidebar.
- **Main area:** any `.orcagraph` file opens as a graph tab. `{}` follows the newest run; `{ "runId": "<run id>" }` pins one. The tab bar **+** menu has "Orchestration run graph".
- **Demo:** pick "Demo · sample data" in the run dropdown to see every status, agent badges and a gate.

Clicking a card opens the worktree of the task's worker. Orca 1.4.259+ focuses its terminal instead.

## How it works

Plugins have no orchestration API, so the worker (`worker/main.mjs`) runs `orca.exe orchestration run-list | task-list | gate-list | worker-list --json --full` and hands the result to the panel. The panel (`panel/`) lays it out with a vendored copy of [dagre](https://github.com/dagrejs/dagre) 1.1.4 (MIT, `panel/vendor/dagre.LICENSE`). It refreshes on `agent.status.changed` and every 5 s while visible.

## Develop

From WSL, `orca-ide` refuses the plugin authoring commands, so call the Windows binary with the folder's `\\wsl.localhost` path:

```sh
ORCA=/mnt/c/Users/florian/AppData/Local/Programs/orca/resources/bin/orca.exe
DIR='\\wsl.localhost\Ubuntu-22.04\home\florian\dev\ai-setup\orca-plugins\orch-dag'
"$ORCA" plugin validate "$DIR" --json
"$ORCA" plugin dev load "$DIR" --json      # prints the --approve fingerprint the first time
"$ORCA" plugin dev reload "$DIR" --json    # Orca sees WSL edits one reload late: run it twice
```
