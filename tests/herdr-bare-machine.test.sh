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

test_missing_herdr_is_installed_with_the_official_installer() {
  # Arrange
  new_repo_copy
  herdr_not_installed
  herdr_with_window

  # Act
  install
  local code=$?

  # Assert: the installer's ~/.local/bin isn't on PATH, and the run still finds it
  assert_eq 0 "$code" "exit code"
  assert_contains "$SANDBOX/tool-calls.log" "https://releases.herdr.dev/app/install.sh"
  assert_contains "$SANDBOX/tool-calls.log" "fake herdr installer ran"
  assert_file "$SANDBOX_HOME/.local/bin/herdr-app"
  assert_eq "main-git" "$(json_get "$HERDR/shared.json" layout)" "shown layout"
}

test_herdr_in_the_installers_folder_is_not_installed_again() {
  # Arrange: installed by an earlier run, in a shell that never had it on PATH
  new_repo_copy
  herdr_not_installed
  mkdir -p "$SANDBOX_HOME/.local/bin"
  cp "$SANDBOX/installable/herdr-app" "$SANDBOX_HOME/.local/bin/herdr-app"
  herdr_with_window

  # Act
  install

  # Assert
  assert_no_file "$SANDBOX/tool-calls.log"
  assert_eq "main-git" "$(json_get "$HERDR/shared.json" layout)" "shown layout"
}

assert_herdr_install_failed_but_the_rest_installed() {
  assert_eq 0 "$1" "exit code"
  assert_contains "$OUT" "could not install herdr"
  assert_no_file "$HERDR"
  assert_file "$SANDBOX_HOME/.claude/AGENTS.md"
  assert_contains "$OUT" "Done"
}

test_a_failed_download_leaves_the_rest_of_the_install() {
  # Arrange
  new_repo_copy
  herdr_not_installed
  touch "$SANDBOX/curl-fails"

  # Act
  install
  local code=$?

  # Assert
  assert_herdr_install_failed_but_the_rest_installed "$code"
  assert_lacks "$SANDBOX/tool-calls.log" "fake herdr installer ran"
}

test_a_failed_installer_leaves_the_rest_of_the_install() {
  # Arrange
  new_repo_copy
  herdr_not_installed
  touch "$SANDBOX/installer-fails"

  # Act
  install
  local code=$?

  # Assert
  assert_herdr_install_failed_but_the_rest_installed "$code"
}

test_windows_uses_herdrs_powershell_installer() {
  # Arrange
  new_repo_copy
  herdr_not_installed
  give_tools powershell

  # Act
  FAKE_UNAME="MINGW64_NT-10.0-19045" install

  # Assert
  assert_contains "$SANDBOX/tool-calls.log" "powershell -c irm https://releases.herdr.dev/app/install.ps1 | iex"
  assert_lacks "$SANDBOX/tool-calls.log" "curl"
}

test_dry_run_does_not_run_the_installer() {
  # Arrange
  new_repo_copy
  herdr_not_installed
  local before
  before="$(tree_state)"

  # Act
  install --dry-run
  local code=$?

  # Assert
  assert_eq 0 "$code" "exit code"
  assert_eq "$before" "$(tree_state)" "home"
  assert_no_file "$SANDBOX/tool-calls.log"
  assert_contains "$OUT" "[dry-run] would install herdr from https://releases.herdr.dev/app/install.sh"
}

run_all() {
  test_case "linux with no display skips herdr in one line" test_linux_with_no_display_skips_herdr_in_one_line
  test_case "wayland alone counts as a display" test_wayland_alone_counts_as_a_display
  test_case "macos needs no display variable" test_macos_needs_no_display_variable
  test_case "missing herdr is installed with the official installer" test_missing_herdr_is_installed_with_the_official_installer
  test_case "herdr in the installer's folder is not installed again" test_herdr_in_the_installers_folder_is_not_installed_again
  test_case "a failed download leaves the rest of the install" test_a_failed_download_leaves_the_rest_of_the_install
  test_case "a failed installer leaves the rest of the install" test_a_failed_installer_leaves_the_rest_of_the_install
  test_case "windows uses herdr's powershell installer" test_windows_uses_herdrs_powershell_installer
  test_case "dry run does not run the installer" test_dry_run_does_not_run_the_installer
}

run_all
finish
