#!/usr/bin/env bash
# One run of install on a machine with no herdr. See tests/helpers.sh for the isolation.

# shellcheck source=tests/helpers.sh
source "$(dirname "${BASH_SOURCE[0]}")/helpers.sh"

test_linux_with_no_display_skips_herdr_in_one_line() {
  # Arrange
  new_repo_copy
  herdr_not_installed

  # Act
  FAKE_DISPLAY="" install
  local code=$?

  # Assert
  assert_eq 0 "$code" "exit code"
  assert_eq 1 "$(grep -c -i herdr "$OUT")" "lines about herdr"
  assert_contains "$OUT" "no DISPLAY or WAYLAND_DISPLAY"
  assert_no_file "$HERDR"
  assert_no_file "$SANDBOX/tool-calls.log"
  assert_file "$SANDBOX_HOME/.claude/AGENTS.md"
}

test_wayland_alone_counts_as_a_display() {
  # Arrange
  new_repo_copy
  herdr_with_window

  # Act
  FAKE_DISPLAY="" FAKE_WAYLAND_DISPLAY="wayland-0" install

  # Assert
  assert_eq "main-git" "$(json_get "$HERDR/shared.json" layout)" "shown layout"
}

test_macos_needs_no_display_variable() {
  # Arrange
  new_repo_copy
  herdr_with_window

  # Act
  FAKE_DISPLAY="" FAKE_UNAME="Darwin" install

  # Assert
  assert_eq "main-git" "$(json_get "$HERDR/shared.json" layout)" "shown layout"
}

run_all() {
  test_case "linux with no display skips herdr in one line" test_linux_with_no_display_skips_herdr_in_one_line
  test_case "wayland alone counts as a display" test_wayland_alone_counts_as_a_display
  test_case "macos needs no display variable" test_macos_needs_no_display_variable
}

run_all
finish
