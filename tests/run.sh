#!/usr/bin/env bash
# Run every test: the Git panel's pure logic under node, install under bash.
# Needs only node, python3, patch and git; herdr itself is faked.

cd "$(dirname "${BASH_SOURCE[0]}")/.." || exit 1

status=0
node --test tests/*.test.mjs || status=1
for script in tests/*.test.sh; do
  bash "$script" || status=1
done
exit "$status"
