# Coding Standards

Read during review. Shellcheck, gitleaks, the test suite and `claude plugin validate` run in CI; this file holds the judgement calls.

## Comments

- A comment that explains our own surprising code is a flag: rename or extract so the code says it. Comments that stay: the `Format:` headers in `manifests/*.txt`, `# shellcheck disable` directives that give the reason on the same line, and comments that explain how Claude Code, npx skills or Windows behave.
