#!/usr/bin/env bash
# The Usage meter's status line: what it saves of Claude's limits and the line it prints.

# shellcheck source=tests/helpers.sh
source "$(dirname "${BASH_SOURCE[0]}")/helpers.sh"

STATUSLINE="$REPO/herdr/mods/claude-usage/statusline.sh"
NOW="$(date +%s)"
HOUR=3600

limits_file() {
  printf '%s' "$SANDBOX_HOME/.cache/claude-usage/limits.json"
}

# A reply's status line input, with the 5-hour limit $1% used and resetting at $2.
reply_with_limits() {
  printf '{"model":{"display_name":"Opus 5.5"},"context_window":{"used_percentage":34.2},"rate_limits":{"five_hour":{"used_percentage":%s,"resets_at":%s},"seven_day":{"used_percentage":18,"resets_at":%s}}}' \
    "$1" "$2" "$((NOW + 72 * HOUR))"
}

run_statusline() {
  OUT="$SANDBOX/out"
  env -i HOME="$SANDBOX_HOME" PATH="$SYSTEM_TOOLS" bash "$STATUSLINE" <<<"$1" >"$OUT" 2>&1
}

saved_five_hour() {
  python3 -c 'import json, sys; l = json.load(open(sys.argv[1]))["five_hour"]; print(l["used_percentage"], l["resets_at"])' "$(limits_file)"
}

test_a_reply_saves_its_limits_and_prints_model_and_context() {
  # Act
  run_statusline "$(reply_with_limits 42 "$((NOW + 2 * HOUR))")"
  local code=$?

  # Assert
  assert_eq 0 "$code" "exit code"
  assert_eq "Opus 5.5 · 34% context" "$(cat "$OUT")" "line"
  assert_eq "42 $((NOW + 2 * HOUR))" "$(saved_five_hour)" "saved 5-hour limit"
}

test_an_older_reading_of_the_same_window_is_not_saved() {
  # Arrange: another session replied later, with more used
  run_statusline "$(reply_with_limits 60 "$((NOW + 2 * HOUR))")"

  # Act
  run_statusline "$(reply_with_limits 42 "$((NOW + 2 * HOUR + 30))")"

  # Assert
  assert_eq "60 $((NOW + 2 * HOUR))" "$(saved_five_hour)" "saved 5-hour limit"
}

test_a_reading_of_the_next_window_replaces_the_last_one() {
  # Arrange
  run_statusline "$(reply_with_limits 90 "$((NOW + 60))")"

  # Act
  run_statusline "$(reply_with_limits 3 "$((NOW + 5 * HOUR))")"

  # Assert
  assert_eq "3 $((NOW + 5 * HOUR))" "$(saved_five_hour)" "saved 5-hour limit"
}

test_a_reading_of_an_earlier_window_is_not_saved() {
  # Arrange
  run_statusline "$(reply_with_limits 3 "$((NOW + 5 * HOUR))")"

  # Act
  run_statusline "$(reply_with_limits 90 "$((NOW + 60))")"

  # Assert
  assert_eq "3 $((NOW + 5 * HOUR))" "$(saved_five_hour)" "saved 5-hour limit"
}

test_a_reply_without_limits_saves_nothing() {
  # Act
  run_statusline '{"model":{"display_name":"Opus 5.5"},"context_window":{"used_percentage":null}}'
  local code=$?

  # Assert
  assert_eq 0 "$code" "exit code"
  assert_eq "Opus 5.5" "$(cat "$OUT")" "line"
  assert_no_file "$(limits_file)"
}

test_case "a reply saves its limits and prints the model and context" test_a_reply_saves_its_limits_and_prints_model_and_context
test_case "an older reading of the same window is not saved" test_an_older_reading_of_the_same_window_is_not_saved
test_case "a reading of the next window replaces the last one" test_a_reading_of_the_next_window_replaces_the_last_one
test_case "a reading of an earlier window is not saved" test_a_reading_of_an_earlier_window_is_not_saved
test_case "a reply without limits saves nothing" test_a_reply_without_limits_saves_nothing
finish
