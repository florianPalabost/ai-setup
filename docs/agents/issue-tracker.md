# Issue tracker: GitHub

Issues and specs for this repo live as GitHub issues. Use the `gh` CLI for all operations.

## Conventions

- **Create an issue**: `gh issue create --title "..." --body "..."`. Use a heredoc for multi-line bodies.
- **List issues**: list an index first, then read only the issues you work on (**Read an issue**). Never list bodies or comments: a 30-issue listing with them costs about 10× the tokens of the index. `gh issue list` stops at 30 issues without `--limit`, so a plain listing can silently miss tickets. Use the paged index query below, 50 issues per call, which also returns each issue's open blockers:
  ```sh
  gh api graphql -F owner='{owner}' -F name='{repo}' -F first=50 -f query='
  query($owner: String!, $name: String!, $first: Int!, $after: String, $labels: [String!]) {
    repository(owner: $owner, name: $name) {
      issues(states: OPEN, first: $first, after: $after, labels: $labels, orderBy: {field: CREATED_AT, direction: ASC}) {
        totalCount pageInfo { hasNextPage endCursor }
        nodes { number title labels(first: 10) { nodes { name } } assignees(first: 3) { nodes { login } } issueDependenciesSummary { blockedBy } parent { number } }
      }
    }
  }' --jq '.data.repository.issues | {total: .totalCount, next: (if .pageInfo.hasNextPage then .pageInfo.endCursor else null end), issues: [.nodes[] | {number, title, labels: [.labels.nodes[].name], assignees: [.assignees.nodes[].login], openBlockers: .issueDependenciesSummary.blockedBy, parent: .parent.number}]}'
  ```
  Add `-f 'labels[]=<label>'` (repeatable, matches any) to filter. Fetch the next page with `-f after=<next>` only when you need more than the first page, for example to find the next unblocked ticket. Stop as soon as you have found it.
- **Read an issue**: lazily, in two steps. First the body: `gh issue view <number> --json number,title,body,labels --jq '{number, title, labels: [.labels[].name], body}'`. Then the comments, only when the body alone isn't enough or the task is about the discussion. Start with the latest five, and fetch the rest only if you still need them: `gh issue view <number> --json comments --jq '{count: (.comments | length), latest: [.comments[-5:][] | {author: .author.login, body}]}'`.
- **Make an issue a sub-issue of a parent**: `gh issue create --parent <parent> ...`, or `gh issue edit <parent> --add-sub-issue <child>` afterwards (`gh` 2.94+). Older `gh`: `gh api --method POST repos/<owner>/<repo>/issues/<parent>/sub_issues -F sub_issue_id=<child-db-id>` (database id, as in **Blocking** below). Without sub-issues, put `Part of #<parent>` at the top of the child body.
- **Blocking**: GitHub's **native issue dependencies**, the canonical, UI-visible representation. Add an edge with `gh issue create --blocked-by <n>,<n> ...` or `gh issue edit <child> --add-blocked-by <blocker>` (`gh` 2.94+). Older `gh`: `gh api --method POST repos/<owner>/<repo>/issues/<child>/dependencies/blocked_by -F issue_id=<blocker-db-id>`, where `<blocker-db-id>` is the blocker's numeric **database id** (`gh api repos/<owner>/<repo>/issues/<n> --jq .id`, _not_ the `#number` or `node_id`). Where dependencies aren't available, fall back to a `Blocked by: #<n>, #<n>` line at the top of the child body. A ticket is unblocked when every blocker is closed.
- **Count open blockers**: for many issues, read `openBlockers` from the **List issues** index; never make one call per issue. For one issue: `gh api repos/{owner}/{repo}/issues/<n> --jq .issue_dependencies_summary.blocked_by` (open blockers only; 0 means startable). `gh issue view <n> --json blockedBy` also lists closed blockers, so filter it: `--jq '[.blockedBy.nodes[] | select(.state == "OPEN")] | length'`.
- **Comment on an issue**: `gh issue comment <number> --body "..."`
- **Apply / remove labels**: `gh issue edit <number> --add-label "..."` / `--remove-label "..."`
- **Close**: post the explanation with `gh issue comment <number> --body "..."`, then `gh issue close <number>`. On an already-closed issue, `gh issue close --comment` drops the comment and still exits 0.

Infer the repo from `git remote -v`; `gh` does this automatically when run inside a clone.

File issues only into the user's own repo. Never file into `mattpocock/skills` (the repo these skills come from) unless the user owns it. In a fork, `gh` can default to the upstream parent, so before the first `gh issue create` of a session, check the target with `gh repo view --json nameWithOwner` and confirm it with the user if it is not their repo.

## Pull requests as a triage surface

**PRs as a request surface: no.** _(Set to `yes` if this repo treats external PRs as feature requests; `/triage` reads this flag.)_

When set to `yes`, PRs run through the same labels and states as issues, using the `gh pr` equivalents:

- **Read a PR**: `gh pr view <number>`, then `gh pr view <number> --comments` (off a TTY, `--comments` prints only the comments, not the body), and `gh pr diff <number>` for the diff.
- **List external PRs for triage**: an index only; read a PR's body and diff once you work on it. `gh api --paginate 'repos/{owner}/{repo}/pulls?state=open&per_page=100' --jq '.[] | select(.author_association | IN("OWNER","MEMBER","COLLABORATOR") | not) | {number, title, author: .user.login, author_association, labels: [.labels[].name]}'`.
- **Comment / label / close**: `gh pr comment`, `gh pr edit --add-label`/`--remove-label`, `gh pr close`.

GitHub shares one number space across issues and PRs, so a bare `#42` may be either: resolve with `gh pr view 42` and fall back to `gh issue view 42`.

## When a skill says "publish to the issue tracker"

Create a GitHub issue.

## When a skill says "fetch the relevant ticket"

Read it as in **Read an issue** above: the body first, the comments only if needed.

## Wayfinding operations

Used by `/wayfinder`. The **map** is a single issue with **child** issues as tickets.

- **Map**: a single issue labelled `wayfinder:map`, holding the Notes / Decisions-so-far / Fog body. `gh issue create --label wayfinder:map`.
- **Child ticket**: an issue linked to the map as a GitHub sub-issue (see **Make an issue a sub-issue of a parent**). Where sub-issues aren't enabled, add the child to a task list in the map body and put `Part of #<map>` at the top of the child body. Labels: `wayfinder:<type>` (`research`/`prototype`/`grilling`/`task`). Once claimed, the ticket is assigned to the driving dev.
- **Blocking**: see **Blocking** under Conventions.
- **Frontier query**: one call lists the map's children in map order, with their state, open blockers and assignee count. No bodies: read the chosen ticket afterwards (**Read an issue**).
  ```sh
  gh api graphql -F owner='{owner}' -F name='{repo}' -F map=<map> -f query='
  query($owner: String!, $name: String!, $map: Int!) {
    repository(owner: $owner, name: $name) { issue(number: $map) { subIssues(first: 100) { nodes { number title state issueDependenciesSummary { blockedBy } assignees { totalCount } } } } }
  }' --jq '[.data.repository.issue.subIssues.nodes[] | select(.state == "OPEN") | {number, title, openBlockers: .issueDependenciesSummary.blockedBy, assignees: .assignees.totalCount}]'
  ```
  Drop any child with `openBlockers > 0` or an assignee; the first left wins. Where sub-issues aren't enabled, take the children from the map body's task list instead, and their open blockers and assignees from the **List issues** index or the `Blocked by` line.
- **Claim**: `gh issue edit <n> --add-assignee @me`, the session's first write.
- **Resolve**: `gh issue comment <n> --body "<answer>"`, then `gh issue close <n>`, then append a context pointer (gist + link) to the map's Decisions-so-far.
