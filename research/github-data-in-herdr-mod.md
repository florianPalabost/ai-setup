# Getting GitHub data inside a herdr mod

Research for #4 (map #2, "Herdr git & GitHub integration"). Checked on 2026-11-02
with herdr-app 0.1.11 (gpui-shell 0.7.1) and gh 2.100.0, authed as `florianPalabost`
(token in `~/.config/gh/hosts.yml`, scopes `gist, read:org, repo, workflow`).

## Answer in short

- **Use `gh` through herdr's `exec`, calling one GraphQL query per view.** gh handles
  auth (and token refresh), so the mod never holds a token. `gh api --cache` removes
  duplicate calls between mod copies, and one call costs about 0.3 to 1.2 s and 1 GraphQL
  point, well inside the 30 s / 8 MiB limits.
- `fetch` with a token works but gives little in return. Herdr's `fetch` accepts an
  `Authorization` header. Its response has no `headers`, so you can't read ETags or
  `x-ratelimit-*`. You would still need `exec("gh", ["auth", "token"])` to get the token.
  Use it only if process spawn cost ever matters.
- **Skip ETags/conditional requests.** GraphQL is POST-only, and GitHub doesn't support
  conditional unsafe methods. herdr's `fetch` can't read the ETag. One GraphQL call
  (1 point) per refresh is cheap enough.
- **Refresh by event first, then on a slow timer.** Refresh on context change and when a
  terminal in that repo goes from busy to idle, as the `spaces` mod does. Add a 60 s timer
  while CI is pending and 5 min otherwise, run only while `window().active`, and call
  `cx.notify()` only when the data changed. That costs at most about 72 points/h against
  5,000/h.
- **Repo/branch: copy the `changes` mod's `location()`.** Take the cwd from the focused pane,
  else `focused().cwd`, else `space.folder`. Running `gh pr view --json …` in that cwd
  resolves owner/repo and branch itself, in one GraphQL request.

## 1. What herdr gives a mod

### `exec`

`~/.config/herdr-app/herdr.d.ts`:

> Runs a program with the user's real environment (HOME, PATH, auth). 30 s limit, 8 MiB output.
> `on`: on that machine (a space's `machine`) through herdr-core, its home by default.
> Rejects when it can't start (not installed, no such folder, the machine is unreachable).

```ts
export function exec(command: string, args?: string[], options?: { cwd?: string; on?: string | null }): Promise<ExecResult>;
// ExecResult = { code: number; stdout: string; stderr: string }
```

It takes args as an array, with no shell, so you can pass a GraphQL query inline as
`-f query=...` without quoting problems. `AGENTS.md` ("The `herdr` module", "Machine"):
"`exec(cmd, args, { cwd, on })` (the user's real environment; use this, not `process.run`)".

### `fetch`

`AGENTS.md` ("The `herdr` module"): "Mods are trusted code: commands and network access
(including `fetch`) are unrestricted. Other built-ins: `localStorage` (per mod copy),
`console.log`, `fetch`, …". The type in `~/.config/herdr-app/gpui-kit.d.ts` (around line 22169):

```ts
interface ShellFetchResponse {
  readonly status: number; readonly ok: boolean; readonly url: string;
  text(): Promise<string>; json(): Promise<unknown>;
}
interface ShellFetchOptions {
  method?: string;
  /** Client-managed framing headers such as Host and Content-Length are refused. */
  headers?: Record<string, string>;
  body?: string | Uint8Array;
}
```

- Request headers are supported, and only framing headers (Host, Content-Length) are
  refused. The "Credential … headers are refused" note applies to the `websocket` module,
  not to `fetch`.
- In the binary's strings (`strings ~/.local/bin/herdr-app`), the only Authorization rule
  for `fetch` is `cross-origin redirect from … refused because the request carries
  Authorization`. So a Bearer token is allowed, but redirects to another origin are not
  followed. That's fine for `api.github.com`.
- **The response type has no `headers`.** You can't read `ETag`, `x-ratelimit-remaining`,
  `retry-after` or `x-poll-interval`.
- Not verified in a live window: `herdr-app check` renders once and doesn't await
  `cx.spawn` work (`gpui-shell check --help`: "Does not check … asynchronous states"). A
  probe mod that tests token + `fetch` + `exec` end to end is at
  `<scratchpad>/probe/main.js` (not committed). Its code is in the appendix.

### Timers and battery

`AGENTS.md` ("A mod" rules and the mods section):

- "No `setTimeout`/`setInterval` (use `cx.timer`) … Anything slow goes through `exec` or `fetch`."
- "Its timers keep running while hidden, so poll gently."
- "Every redraw of a mod redraws the whole window … Timers are for data (a clock, a
  fetch), and only as often as what they show changes."
- `render` runs again "whenever Herdr's live data changes (spaces, agents, terminals,
  focus, theme, shared state). Don't poll those."

The shipped mods' cadences: `changes` uses `cx.timer.every(10000)` plus `watchFolder` on the
repo. `spaces` runs a 250 ms tick that only *decides* what is due and calls `cx.notify()`
only on change. It refreshes git when a pane goes from busy to idle, and runs a 60 s
`FALLBACK` only while `window().active` (`mods/spaces/main.js` lines 33, 70, 107).

## 2. Detecting the repo and branch of the shown space

The `changes` mod (`~/.config/herdr-app/mods/changes/main.js`, lines 5–10) shows the pattern:

```js
function location() {
  const space = spaces().find((s) => s.active), f = focused();
  const pane = f?.pane ? panes().find(p => p.pane === f.pane) : null;
  const on = f?.pane === null ? (f.terminal?.includes("/") ? f.terminal.split("/")[0] : null) : space?.machine ?? null;
  return { cwd: pane?.cwd || f?.cwd || space?.folder, on };
}
const key = () => JSON.stringify(location());
```

It then runs `git rev-parse --show-toplevel` in that cwd. When `key()` changes, it resets
its state and refreshes.

Where herdr already knows the branch, without running anything:

- `PaneInfo.branch`: "Its live folder, and the git branch there" (`herdr.d.ts`).
- `SpaceInfo.branch`: "The git branch of the terminal it shows first, if any".
- The `spaces` mod uses another place rule: the space's first terminal with a cwd, else
  `s.folder` (`place()`, `mods/spaces/main.js` line 23). `AGENTS.md` says "the default
  mods take a space's repo from its first terminal".

For a PR view that follows what you're looking at, use `changes`' `location()`. Add
`branch: pane?.branch ?? space?.branch` to it, and re-key on it, so a `git switch` in the
pane triggers a refresh (render reruns on live pane data).

Owner/repo, cheapest first:

1. Let gh resolve it: run `gh pr view --json …` with `cwd` and no argument. gh reads the
   git remotes and `gh repo set-default`, and finds the PR for the current branch's push
   target. Verified with `GH_DEBUG=api`: **one** request to `/graphql`.
2. Parse `git remote get-url origin` locally (no API call). Use this when you build the
   raw GraphQL query yourself. It's wrong for fork setups where the PR lives on `upstream`.
3. `gh repo view --json nameWithOwner` (one API call). Cache it per repo root.

Remote spaces (`on` set) are out of scope (#2), because `exec(..., {on})` would run `gh` on
that machine, where it isn't authed. Skip GitHub data when `on !== null`, or run `gh` here
with `-R owner/repo` from the remote's URL.

## 3. Queries (tested)

### (a) The PR for a repo + branch

**Simplest, with gh choosing the PR:**

```sh
# in the repo's cwd: current branch
gh pr view --json number,title,url,state,isDraft,reviewDecision,mergeStateStatus,headRefName,statusCheckRollup
# or a named branch
gh pr view feat/bourse-news -R florianPalabost/lara-vision --json number,state,isDraft,reviewDecision,statusCheckRollup
```

- It exits with code 1 and prints `no pull requests found for branch "…"` on stderr when
  there's none (verified). Treat that as "no PR", not as an error.
- With a branch argument it also finds merged/closed PRs (verified: it returned #98 MERGED).
- `statusCheckRollup` is a flat array of `CheckRun` (`name, status, conclusion,
  workflowName, detailsUrl, startedAt, completedAt`) and `StatusContext` (`context,
  state, targetUrl`) items. gh doesn't return the rollup `state`, so compute it yourself.
- `reviewDecision` is `""` when the repo has no review rules (raw GraphQL gives `null`).

**Raw GraphQL, with the rollup state and per-state counts in one call (cost 1):**

```graphql
query PrForBranch($owner: String!, $name: String!, $branch: String!) {
  repository(owner: $owner, name: $name) {
    pullRequests(headRefName: $branch, first: 5, states: [OPEN, MERGED, CLOSED],
                 orderBy: {field: UPDATED_AT, direction: DESC}) {
      nodes {
        number title url state isDraft reviewDecision mergeStateStatus
        headRefOid headRepositoryOwner { login }
        reviewRequests(first: 10) { totalCount }
        latestReviews(first: 10) { nodes { author { login } state } }
        commits(last: 1) {
          nodes {
            commit {
              oid
              statusCheckRollup {
                state
                contexts(first: 50) {
                  totalCount
                  checkRunCountsByState { state count }
                  statusContextCountsByState { state count }
                  nodes {
                    __typename
                    ... on CheckRun { name status conclusion detailsUrl }
                    ... on StatusContext { context state targetUrl }
                  }
                }
              }
            }
          }
        }
      }
    }
  }
  rateLimit { cost remaining resetAt }
}
```

```sh
gh api graphql -F owner=cli -F name=cli -F branch=williammartin-global-feature-flags -F query=@pr-for-branch.graphql
```

Verified results:

- `cli/cli` `williammartin-global-feature-flags`: `#14781 OPEN, isDraft true,
  reviewDecision REVIEW_REQUIRED, mergeStateStatus BLOCKED, rollup SUCCESS, 18 contexts`.
- `florianPalabost/lara-vision` `feat/bourse-news`: `#98 MERGED, rollup SUCCESS` with 2
  CheckRuns and 1 StatusContext (CodeRabbit). `rateLimit.cost` was `1`.

Notes:

- `headRefName` matches forks' branches with the same name too (think `main`, `patch-1`).
  Keep the node whose `headRepositoryOwner.login` is the owner you pushed to. Prefer
  `OPEN`, then the most recently updated.
- `statusCheckRollup.state` is one of `SUCCESS | FAILURE | ERROR | PENDING | EXPECTED`. It
  is `null` (no rollup) when the commit has no checks. Show "pending" for
  `PENDING`/`EXPECTED`, and also use it to pick the fast refresh rate (§5).
- `checkRunCountsByState` gives a "12 ✓ 1 ✗ 3 …" summary without walking the nodes.
  Drop `nodes` from the list view.
- `reviewDecision`: `APPROVED | CHANGES_REQUESTED | REVIEW_REQUIRED | null`.

### (b) My open PRs plus review requests, across repos

One GraphQL call with two aliased searches (cost 1):

```graphql
query MyPrs($mine: String!, $review: String!) {
  viewer { login }
  mine: search(type: ISSUE, query: $mine, first: 50) { issueCount nodes { ...Pr } }
  review: search(type: ISSUE, query: $review, first: 50) { issueCount nodes { ...Pr } }
  rateLimit { cost remaining resetAt }
}
fragment Pr on PullRequest {
  number title url isDraft reviewDecision updatedAt headRefName
  repository { nameWithOwner }
  author { login }
  commits(last: 1) { nodes { commit { statusCheckRollup { state } } } }
}
```

```sh
gh api graphql -F query=@my-prs.graphql \
  -f mine='is:pr is:open archived:false author:@me sort:updated-desc' \
  -f review='is:pr is:open archived:false review-requested:@me sort:updated-desc'
```

Verified:

- For `@me` it returns `{"viewer":{"login":"florianPalabost"},"mine":{"issueCount":0},"review":{"issueCount":0}}`.
  There are no open PRs right now. `gh search prs` confirms this.
- The same query with `author:williammartin` returned 12 PRs, with `repository`,
  `isDraft`, `reviewDecision` and rollup `state` filled. `cost: 1`.
- `review-requested:` includes team requests (`williammartin`: 205), while
  `user-review-requested:` only counts direct ones (9). For "asked of me", prefer
  `user-review-requested:@me`, or show both.
- `@me` works inside GraphQL search strings. GraphQL search uses GraphQL points, not the
  REST search limit of 30 requests/min.

The CLI alternative is `gh search prs --author=@me --state=open --json
repository,number,title,isDraft,url,updatedAt` and `--review-requested=@me`. Its `--json`
fields have no `reviewDecision`, checks or `headRefName` (verified: "Unknown JSON field"),
and it uses REST search (30/min). It takes two calls for less data, so use the GraphQL query.

## 4. `exec` + gh vs `fetch` + token

| | `exec("gh", ["api", "graphql", …])` | `fetch("https://api.github.com/graphql", …)` |
|---|---|---|
| Auth | gh's stored token. `gh auth token` "is refreshed automatically before being printed" when it supports refresh (gh manual). The mod never sees it. | Needs a token. The only clean source on this machine is `exec("gh", ["auth","token"])`, so it still depends on gh, and the token sits in mod memory (don't `console.log` it, don't put it in `localStorage`). |
| Cost per call | Spawns a process: measured 1.2 s cold, 0.3 s from `--cache` (WSL). Well under the 30 s limit. Output is a few KB against 8 MiB. | No spawn, likely lower latency (not measured in a live window, see §1). |
| Headers | `gh api -i` shows `ETag`, `X-Ratelimit-*`, `Cache-Control: private, max-age=60`. | Not readable (no `headers` on the response). Use the `rateLimit { … }` field in the GraphQL body instead. |
| Caching | `gh api --cache 60s` works for GraphQL POSTs too (verified: the second call took 0.3 s and `remaining` didn't change). The cache is shared by every mod copy. | Do it yourself in memory or `localStorage`. |
| Errors | Exit code + stderr (`gh` prints the GraphQL errors). | HTTP status. A 401 means the token went stale: fetch a new one. |
| Remote machines | `on:` runs gh there (not authed, out of scope). | Runs here regardless. |

Recommendation: **`exec` + gh**, with `--cache` set a little below the refresh interval
(for example `--cache 30s` for a 60 s poll). Copies of the mod in other layouts or hidden
stacks then share one network call. Move to `fetch` only if spawn cost turns out to
matter, keeping the token in memory and refreshing it on 401.

Call shape (no shell, query inline):

```js
const r = await exec("gh", ["api", "graphql", "--cache", "30s",
  "-F", `owner=${owner}`, "-F", `name=${name}`, "-F", `branch=${branch}`,
  "-f", `query=${PR_FOR_BRANCH}`], { cwd: root });
if (r.code !== 0) { /* r.stderr: auth, network, GraphQL errors */ }
const data = JSON.parse(r.stdout).data;
```

`-F` turns `true`, `false`, `null` and integers into JSON types. Use `-f` (raw string) for
values that might look like those, for example a branch named `123`.

## 5. Rate limits and refresh intervals

GitHub's numbers (quoted from the docs):

- GraphQL primary: "5,000 points per hour per user". A call costs the number of
  connection requests ÷ 100, rounded, with a minimum of **1**. Secondary: "no more than
  2,000 points per minute", and "No more than 100 concurrent requests … shared across the
  REST API and GraphQL API"
  ([GraphQL rate limits](https://docs.github.com/en/graphql/overview/rate-limits-and-query-limits-for-the-graphql-api)).
  `first`/`last` must be 1–100.
- REST primary: "5,000 requests per hour". Secondary: 900 points/min, with GET = 1 point
  ([REST rate limits](https://docs.github.com/en/rest/using-the-rest-api/rate-limits-for-the-rest-api)).
  On 403/429, wait for `retry-after`, else `x-ratelimit-reset`, else at least a minute.
- REST search: "up to 30 requests per minute" authenticated
  ([Search](https://docs.github.com/en/rest/search/search)).
- Conditional requests: "Making a conditional request does not count against your
  primary rate limit if a `304` response is returned and the request was made while
  correctly authorized with an `Authorization` header"
  ([best practices](https://docs.github.com/en/rest/using-the-rest-api/best-practices-for-using-the-rest-api)).
  **Observed here:** `gh api -H 'If-None-Match: "<etag>"'` did return `304`, but ten 304s
  raised `core.used` by 12, against 1 of idle drift. Other users of the token were active
  at the same time, so this is not conclusive. Don't build on 304s being free.
  The same page says "Conditional requests for unsafe methods, such as `POST` … are not
  supported", so they don't apply to GraphQL.

Both queries above cost **1 point**. Suggested policy:

| View | Trigger | Timer (only while `window().active`) | Points/h at most |
|---|---|---|---|
| PR + checks for the shown branch | `key()` changes (space/pane/cwd/branch); a pane in that repo goes busy → idle (after `git push`, `gh pr create`); the window becomes active again and data is older than the interval | 60 s while the rollup is `PENDING`/`EXPECTED` or a PR is being created; 5 min otherwise; none when no remote/PR was found since the last key change | 60 |
| My PRs + review requests | Mod shown/opened; window activates and data > 2 min old | 5 min | 12 |

- Use one cheap `cx.timer.every(15000, …)` tick that decides what is due, as `spaces` does
  with its 250 ms tick. Herdr's timers keep running while hidden, so check
  `window().active` inside the tick instead of relying on visibility.
- Call `cx.notify()` only when the parsed result differs (compare a JSON string). Every
  redraw redraws the whole window (AGENTS.md).
- Show a spinner with `.frames(...)` or `svg(...).spin(...)`, never with a timer.
- One request at a time per mod. GitHub asks for serial requests with "at least one
  second between each request" (best practices).
- On a non-zero exit with `rate limit` in stderr, or `rateLimit.remaining < 100`, back off
  until `resetAt`.
- With several mod copies (layouts, hidden stacks), `gh --cache` stops each copy from
  hitting the API again. Alternatively, publish results through
  `setShared("github.pr", …)`, though that re-renders every mod.

Budget: about 72 points/h in the worst case, against 5,000/h (1.4%).

## Appendix: probe mod (not committed)

Run it in a live window to confirm `fetch` + Bearer and `exec` latency (`herdr-app check`
doesn't run async work). Remove it afterwards.

```js
import { View, div } from "gpui-kit";
import { exec } from "herdr";
export default class Probe extends View {
  init(_p, cx) {
    cx.spawn(async () => {
      const tok = (await exec("gh", ["auth", "token"])).stdout.trim();
      const g = await fetch("https://api.github.com/graphql", { method: "POST",
        headers: { Authorization: `Bearer ${tok}`, "User-Agent": "herdr-probe" },
        body: JSON.stringify({ query: "{ viewer { login } rateLimit { cost remaining } }" }) });
      console.log("graphql", g.status, await g.text(), "headers:", typeof g.headers);
      const t0 = Date.now();
      const x = await exec("gh", ["api", "graphql", "-f", "query={ viewer { login } }"]);
      console.log("exec gh ms", Date.now() - t0, x.code);
    });
  }
  render() { return div().child("probe"); }
}
```

## Sources

- `~/.config/herdr-app/herdr.d.ts`: `exec`, `spaces()`, `panes()`, `focused()`, `SpaceInfo.branch`, `PaneInfo.branch/cwd`.
- `~/.config/herdr-app/AGENTS.md`: mod rules (timers, battery, `fetch`/`exec`), space/cwd semantics.
- `~/.config/herdr-app/gpui-kit.d.ts` (around line 22140): `fetch` / `ShellFetchResponse` / websocket headers.
- `~/.config/herdr-app/mods/changes/main.js` (`location()`), `mods/spaces/main.js` (`place()`, `due()`, `FALLBACK`).
- `strings ~/.local/bin/herdr-app`: fetch's cross-origin-redirect Authorization rule.
- GitHub docs linked above. `gh help api` (`--cache`), [gh auth token](https://cli.github.com/manual/gh_auth_token).
