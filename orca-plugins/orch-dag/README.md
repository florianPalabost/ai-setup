# Orchestration Graph

A read-only Orca plugin that draws an orchestration run as a graph: a root card for the run, one card per task coloured by status with the agent working on it, a card per decision gate (dashed, pointing at the task it blocks, showing the answer once resolved), arrows from each dependency to the task waiting on it, and dashed edges from a parent task to its `--parent` children.

- **Sidebar:** the "Run graph" panel in the right sidebar.
- **Main area:** any `.orcagraph` file opens as a graph tab. `{}` follows the newest run; `{ "runId": "<run id>" }` pins one. The tab bar **+** menu has "Orchestration run graph".
- **Demo:** pick "Demo · sample run" in the run dropdown. It replays a ticket pipeline every 80 s (a gate resolving, tasks dispatching and completing, sub-steps, then every task completed), so changes to rendering can be checked without a real run.

Clicking a card opens the worktree of the task's worker. Orca 1.4.259+ focuses its terminal instead.

## How it works

Plugins have no orchestration API, so the worker (`worker/main.mjs`) runs `orca.exe orchestration run-list | task-list | gate-list | worker-list --json --full` and hands the result to the panel. The panel (`panel/`) lays it out with a vendored copy of [dagre](https://github.com/dagrejs/dagre) 1.1.4 (MIT, `panel/vendor/dagre.LICENSE`). It polls on `agent.status.changed` and every 5 s while visible, but only repaints cards whose data changed and only re-lays out when a card or edge changed. Age labels tick every 30 s and stop once every task has ended.

## Develop

From WSL, `orca-ide` refuses the plugin authoring commands, so call the Windows binary with the folder's `\\wsl.localhost` path:

```sh
ORCA=/mnt/c/Users/florian/AppData/Local/Programs/orca/resources/bin/orca.exe
DIR='\\wsl.localhost\Ubuntu-22.04\home\florian\dev\ai-setup\orca-plugins\orch-dag'
"$ORCA" plugin validate "$DIR" --json
"$ORCA" plugin dev load "$DIR" --json      # prints the --approve fingerprint the first time
"$ORCA" plugin dev reload "$DIR" --json    # Orca sees WSL edits one reload late: run it twice
```

`plugin shot --editor` captures the frame before the worker's requests finish. Open the demo tab (`orca-ide file open <dir>/demo.orcagraph --focus`, a file containing `{ "runId": "demo" }`), wait a few seconds, then `plugin shot local.orch-dag --window`. Take two shots several seconds apart to see the demo move.
