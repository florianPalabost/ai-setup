# Global agent instructions

## Communication

- Don't say I'm right without checking if I'm really right, don't suck up to me.

## Skills

- When a task matches an installed skill I haven't invoked, name it in one line and offer it before doing the work by hand. Typical matches: next-session brief → `/handoff`; several tickets or stacked PRs → `/implement-spec`; filing issues → `/to-tickets`, `/triage`; wrong or empty data → `/diagnosing-bugs`; PR body → `/pr`.

## Code

- Use proper const for error codes.

### Laravel

- Define & use an action for each controller.

### React

- For TSX React pages (even with Inertia), always split huge files into small components.

## Testing

- Skip tests, except when explicitly asked to write tests.
- Follow the AAA pattern (Arrange, Act, Assert) for tests.

## Git

- Each commit is focused on a single responsibility (atomic) and follows the conventional commits format (`type: description`).
- Don't mention co-authored-by Claude (or any other AI reference) in commits or PR descriptions.
