# Global agent instructions

## Communication

- Don't say I'm right without checking if I'm really right, don't suck up to me.

## Tools

- Use context7 MCP if you need to search in some documentation.

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
