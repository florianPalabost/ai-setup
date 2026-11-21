#!/usr/bin/env bash
# Run every test: the Git panel's pure logic under node, install under bash.
# Needs only node, python3, patch and git; herdr itself is faked.
# Each part is stopped after TIMEOUT_SECS where `timeout` exists (macOS has none).

cd "$(dirname "${BASH_SOURCE[0]}")/.." || exit 1

TIMEOUT_SECS=300
TIMED_OUT=124

# run_part <name> <command...>: runs the command, saying TIMEOUT <name> if it ran too long.
run_part() {
  local name="$1" code
  shift
  if command -v timeout >/dev/null 2>&1; then
    timeout "$TIMEOUT_SECS" "$@"
  else
    "$@"
  fi
  code=$?
  ((code == TIMED_OUT)) && printf 'TIMEOUT %s\n' "$name"
  return "$code"
}

status=0
run_part "tests/*.test.mjs" node --test tests/*.test.mjs || status=1
for script in tests/*.test.sh; do
  run_part "$script" bash "$script" || status=1
done
exit "$status"
