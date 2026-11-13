---
name: coordinate-ticket
description: "Ticket DAG for an Orca orchestration coordinator: every step of a ticket (branch, implementation, verify, review, PR) as a task, every open design question as a gate. Use when coordinating a GitHub issue or ticket with Orca workers, alongside the orchestration skill."
---

# Coordinate a ticket

The run graph is the record of the ticket: the user follows it in the Orchestration Graph panel, which draws only tasks and gates. A step done in chat is invisible there, so every step is a task and every decision is a gate. This skill shapes the DAG; the `orchestration` skill still owns the CLI and the coordinator loop.

## Steps

1. **Read the ticket and the repo rules.** Fetch the issue. Read the repo's `CLAUDE.md` / `AGENTS.md` for its branch rule, test command and review skill. Done when you can name the branch, the full-suite command and every point where the issue leaves the approach open ("either … or …", "decide whether").

2. **Create the run.** `run-create --objective "#<n> <issue title> on <branch>"`. The objective is the root card's label, so it names the ticket and the branch.

3. **Create the tasks in this shape.** Every task gets a `--task-title` of at most six words ("Audit callers", "Open the PR"): the card shows the title, and without one it shows a cut-off spec.

   | Task | Deps | Done by |
   | --- | --- | --- |
   | `Set up branch` | none | you: run the repo's branch rule, then `task-update --status completed --result "<branch> from <base>"` |
   | one task per implementation slice | `Set up branch`, or the slice it builds on | a worker |
   | `Verify` | every slice | a worker: full suite, static analysis, formatter |
   | `Review` | `Verify` | a worker: the repo's review skill (`matt-code-review` by default) on `<base>..HEAD`, fixing real findings |
   | `Open the PR` | `Review` | a worker: push without force, body through `/pr` |

   A step with distinct sub-steps (a review run as Standards and Spec subagents) may get child tasks with `--parent <task>`; the panel draws them under their parent.

4. **Gate every open design question.** For each open point from step 1: `gate-create --task <the task that depends on the answer> --question "…" --options '[…]'`. Ask the user to answer it, then `gate-resolve` with their words. Done when no design choice was settled in chat only.

5. **Ask for evidence in every spec.** End each worker spec with what its `worker_done` must contain:
   - `Verify`: each command run, with pass and fail counts.
   - `Review`: the path of the saved review report, each finding fixed (commit) and each finding rejected (reason).
   - `Open the PR`: the PR URL.
   - every task: its commit hashes.

6. **Run the loop** from the `orchestration` skill. When a worker reports, check its evidence before starting the next task. If a claim needs proof after the worker's terminal has closed, `worker-read --dispatch <dispatchId> --source transcript` still returns its transcript.

Done when every task is `completed` or `failed` with a result, no gate is pending, and the PR URL is in your final message.
