---
name: debug-laravel
description: >
  Laravel-specific error debugging workflow using Laravel Boost MCP tools (last-error, read-log-entries,
  tinker, database-query). Use whenever a Laravel error, exception, 500, failed job, sync error,
  build failure, or unexpected behavior is reported — even if the user just pastes an error message
  or says something like "why is X not working", "fix this error", "there's an issue with Y".
  Prioritize finding root cause before proposing any fix.
---

# Debug Laravel

**Core principle:** Find the root cause first — never guess or apply a fix without evidence.

## Step 1 — Gather evidence in parallel

Run these simultaneously to get full context fast:

1. **Latest errors** — use `last-error` MCP tool to get the most recent exception with stack trace
2. **Application logs** — use `read-log-entries` MCP tool (filter by `level: error` or `level: warning`)
3. **Git diff** — `git diff HEAD~1` to see recent changes that might have caused the issue
4. **Browser logs** — use `browser-logs` MCP tool if the issue is frontend-visible

If the user pasted an error message, use it as the starting point and search for it in logs.

## Step 2 — Identify the failing component

Map the error to one of these categories:
- **Eloquent/DB**: wrong column, missing relationship, N+1, migration not run
- **Queue/Job**: failed job, wrong serialization, missing model
- **Connector/Sync**: HTTP error from external API, rate limit, parsing issue
- **Inertia/Frontend**: component missing, prop shape mismatch, Vite manifest
- **Auth/Middleware**: missing policy, route protection, Fortify config
- **Config/Env**: missing env var, wrong cache, `php artisan config:clear` needed

## Step 3 — Verify hypothesis with tinker or database-query

Before touching code, confirm your theory:

```php
// Example: verify data state
App\Domain\Jobs\Models\JobListing::query()->whereNull('published_at')->count();

// Example: reproduce a failing action
app(App\Domain\Jobs\Actions\SyncJobSourceAction::class)->handle($source);
```

Use `tinker` MCP tool for Eloquent queries. Use `database-query` MCP tool for raw SQL inspection.

## Step 4 — Fix with minimum surface area

- Change only what the root cause requires
- Do not refactor surrounding code as part of a bug fix
- If the fix touches a migration: include ALL previously-defined column attributes (Laravel 12 rule)
- If the fix changes a connector: check sibling connectors for consistent patterns

## Step 5 — Verify the fix

After the fix:
1. Re-run `last-error` / `read-log-entries` to confirm no new exceptions
2. If a test covers the area, run it: `php artisan test --filter=<TestName>`
3. Use `tinker` to reproduce the original scenario if no test exists

## Common Laravel Gotchas in this stack

- **Cursor pagination breaks with certain ORDER BY clauses** — always add secondary `->orderBy('id', 'desc')`
- **Spatie Data boolean filters** — use `$request->has('field') ? $request->boolean('field') : null` pattern
- **Deferred Inertia props** — use closures `fn() =>` in controller to defer heavy queries
- **`array_filter` on filters** — `array_filter($filters->toArray(), fn($v) => $v !== null)` removes nulls before sending to frontend
- **Horizon queues** — check `php artisan horizon:status` if jobs appear stuck
- **Connector rate limits** — check `last-error` for 429 responses before assuming data is missing
