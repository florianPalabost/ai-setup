#!/usr/bin/env bash
# The Usage meter feature: install swaps Claude Code's status line for the meter's
# and puts the meter after the Status bar. See tests/helpers.sh for the isolation.

# shellcheck source=tests/helpers.sh
source "$(dirname "${BASH_SOURCE[0]}")/helpers.sh"

THEIR_STATUSLINE='{"type":"command","command":"orca-statusline"}'

settings_file() {
  printf '%s' "$SANDBOX_HOME/.claude/settings.json"
}

statusline_command() {
  python3 -c 'import json, sys; print((json.load(open(sys.argv[1])).get("statusLine") or {}).get("command"))' "$(settings_file)"
}

their_statusline_set() {
  mkdir -p "$SANDBOX_HOME/.claude"
  printf '{"statusLine":%s}\n' "$THEIR_STATUSLINE" >"$(settings_file)"
}

usage_chosen() {
  mkdir -p "$HERDR"
  printf 'usage %s\n' "$1" >"$HERDR/.ai-setup-features"
}

our_command() {
  printf 'bash "%s"' "$REPO_COPY/herdr/mods/claude-usage/statusline.sh"
}

test_ticking_usage_sets_the_meters_status_line_and_places_the_meter() {
  # Arrange
  new_repo_copy
  herdr_with_window
  their_statusline_set
  usage_chosen on

  # Act
  install
  local code=$?

  # Assert
  assert_eq 0 "$code" "exit code"
  assert_eq "$(our_command)" "$(statusline_command)" "status line"
  assert_eq "row" "$(json_get "$HERDR/layouts/main-git.json" '#status-row.type')" "status row"
  assert_eq "workspace-status-git" "$(json_get "$HERDR/layouts/main-git.json" '#status.content.mod')" "status bar"
  assert_eq "claude-usage" "$(json_get "$HERDR/layouts/main-git.json" '#usage.content.mod')" "usage meter"
  assert_eq "$REPO_COPY/herdr/mods/claude-usage" "$(readlink "$HERDR/mods/claude-usage")" "mod link"
}

test_unticking_usage_puts_their_status_line_back() {
  # Arrange
  new_repo_copy
  herdr_with_window
  their_statusline_set
  usage_chosen on
  install

  # Act
  usage_chosen off
  install
  local code=$?

  # Assert
  assert_eq 0 "$code" "exit code"
  assert_eq "orca-statusline" "$(statusline_command)" "status line"
}

test_a_rerun_keeps_their_status_line_to_put_back() {
  # Arrange
  new_repo_copy
  herdr_with_window
  their_statusline_set
  usage_chosen on
  install
  install

  # Act
  usage_chosen off
  install

  # Assert
  assert_eq "orca-statusline" "$(statusline_command)" "status line"
}

test_unticking_with_no_earlier_status_line_removes_the_meters() {
  # Arrange
  new_repo_copy
  herdr_with_window
  usage_chosen on
  install

  # Act
  usage_chosen off
  install

  # Assert
  assert_eq "None" "$(statusline_command)" "status line"
}

test_a_status_line_changed_since_is_left_alone_on_untick() {
  # Arrange
  new_repo_copy
  herdr_with_window
  usage_chosen on
  install
  their_statusline_set

  # Act
  usage_chosen off
  install

  # Assert
  assert_eq "orca-statusline" "$(statusline_command)" "status line"
}

test_a_dry_run_leaves_their_status_line() {
  # Arrange
  new_repo_copy
  herdr_with_window
  their_statusline_set
  usage_chosen on

  # Act
  install --dry-run
  local code=$?

  # Assert
  assert_eq 0 "$code" "exit code"
  assert_eq "orca-statusline" "$(statusline_command)" "status line"
  assert_no_file "$HERDR/.ai-setup-statusline.json"
  assert_contains "$OUT" "[dry-run] would set the Usage meter's status line"
}

test_case "ticking usage sets the meter's status line and places the meter" test_ticking_usage_sets_the_meters_status_line_and_places_the_meter
test_case "unticking usage puts their status line back" test_unticking_usage_puts_their_status_line_back
test_case "a rerun keeps their status line to put back" test_a_rerun_keeps_their_status_line_to_put_back
test_case "unticking with no earlier status line removes the meter's" test_unticking_with_no_earlier_status_line_removes_the_meters
test_case "a status line changed since is left alone on untick" test_a_status_line_changed_since_is_left_alone_on_untick
test_case "a dry run leaves their status line" test_a_dry_run_leaves_their_status_line
finish
