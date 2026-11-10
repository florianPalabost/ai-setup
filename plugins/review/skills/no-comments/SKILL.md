---
name: no-comments
description: "Comment sweep: delete narration comments in a diff, reshape the code they excuse, and offer checks for claimed constraints. Use after implementing and before review, or when the user asks to clean up comments."
---

# No comments

Adapted from poteto's pstack (MIT, see `../../LICENSE-pstack`).

Spawn Comment Sicko, then act on the findings you accept. Defer to its fresh perspective.

## Scope

Use the caller's files or diff. Otherwise use the diff against the base branch (`git diff <base>...HEAD` plus the working tree). The base is `main`, or the parent feature branch for a child ticket.

## Steps

1. Spawn the Agent tool with `subagent_type: "comment-sicko"`. Pass the scope. Do not restate its rules.

2. Audit its report and diff. Each deletion and flag is accepted or rejected, none left unjudged. Reject:
   - edits to application code or files outside the scope;
   - deletions of a comment its keep list protects, including comments `CODING_STANDARDS.md` requires;
   - `MUST KILL` flags whose reason misstates the code, or that condemn code we keep on purpose.

   A keep survives only with proof it is about something we cannot change. Before accepting a thin `IMPORTANT` or `do not remove` kill or keep, spawn an Explore subagent to verify the claim on its symbol. An ambiguous kill stays deleted; a refuted or ambiguous keep is deleted. Check the scope for lint and type suppressions it missed: correctness or safety suppressions become `MUST KILL`s.

   If you reject a report, revert its edits and rerun Comment Sicko once with the failure named. A second rejected report: revert, report it open, and stop.

3. Fix accepted flags. Trivial ones directly: delete the dead path, drop the parameter, use the real API. When a fix needs a new shape, use the **codebase-design** vocabulary to sketch it for the accepted set, then implement the smallest root-cause fix inside the scope. Remove every workaround a flag names; never add a symptom guard. A root cause outside the scope: land the smallest in-scope fix and report the rest open.

4. Constraint comments (`do not remove`, `do not change wording`, `talk to X before changing`) about things we own: offer the cheapest in-scope encoding (a type, a runtime assertion, a test, a lint rule). In an interactive session, wait for approval; when run from another workflow without the user, encode only what the caller pre-approved. Approved: encode, then delete the comment. Otherwise delete it and report the constraint open.

5. Run the repo's lint and type checks on the touched files. They are green before you report: a deleted PHPDoc type or suppression that breaks them goes back or gets its real fix.

6. Report: deletion count, restored comments, reruns, fixes, encodings made or offered, unenforced constraints, and other open work.
