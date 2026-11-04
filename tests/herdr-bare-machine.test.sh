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

gh_not_installed() {
  rm "$SANDBOX/bin/gh"
}

test_gh_is_installed_with_brew() {
  # Arrange
  new_repo_copy
  herdr_with_window
  gh_not_installed
  give_tools brew winget apt-get sudo

  # Act
  install
  local code=$?

  # Assert
  assert_eq 0 "$code" "exit code"
  assert_contains "$SANDBOX/tool-calls.log" "brew install gh"
  assert_lacks "$SANDBOX/tool-calls.log" "winget"
  assert_lacks "$SANDBOX/tool-calls.log" "sudo"
}

test_gh_is_installed_with_winget() {
  # Arrange
  new_repo_copy
  herdr_with_window
  gh_not_installed
  give_tools winget

  # Act
  install

  # Assert
  assert_contains "$SANDBOX/tool-calls.log" "winget install --id GitHub.cli --exact --silent --accept-package-agreements --accept-source-agreements"
}

test_gh_is_installed_with_apt_when_sudo_needs_no_password() {
  # Arrange
  new_repo_copy
  herdr_with_window
  gh_not_installed
  give_tools apt-get sudo

  # Act
  install

  # Assert
  assert_contains "$SANDBOX/tool-calls.log" "sudo -n true"
  assert_contains "$SANDBOX/tool-calls.log" "sudo -n env DEBIAN_FRONTEND=noninteractive apt-get install -y gh"
}

test_apt_is_not_used_when_sudo_wants_a_password() {
  # Arrange
  new_repo_copy
  herdr_with_window
  gh_not_installed
  give_tools apt-get sudo
  touch "$SANDBOX/sudo-wants-password"

  # Act
  install
  local code=$?

  # Assert
  assert_eq 0 "$code" "exit code"
  assert_contains "$SANDBOX/tool-calls.log" "sudo -n true"
  assert_lacks "$SANDBOX/tool-calls.log" "apt-get"
  assert_contains "$OUT" "gh not installed"
  assert_eq "main-git" "$(json_get "$HERDR/shared.json" layout)" "shown layout"
}

test_a_failed_gh_install_does_not_stop_the_panel() {
  # Arrange
  new_repo_copy
  herdr_with_window
  gh_not_installed
  give_tools brew
  touch "$SANDBOX/brew-fails"

  # Act
  install
  local code=$?

  # Assert
  assert_eq 0 "$code" "exit code"
  assert_contains "$OUT" "could not install gh"
  assert_eq "main-git" "$(json_get "$HERDR/shared.json" layout)" "shown layout"
}

test_gh_already_there_is_left_alone() {
  # Arrange
  new_repo_copy
  herdr_with_window
  give_tools brew

  # Act
  install

  # Assert
  assert_no_file "$SANDBOX/tool-calls.log"
}

test_dry_run_shows_the_gh_install_without_doing_it() {
  # Arrange
  new_repo_copy
  herdr_with_window
  gh_not_installed
  give_tools apt-get sudo

  # Act
  install --dry-run

  # Assert
  assert_contains "$OUT" "[dry-run] sudo -n env DEBIAN_FRONTEND=noninteractive apt-get install -y gh"
  assert_lacks "$SANDBOX/tool-calls.log" "apt-get"
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
  test_case "gh is installed with brew" test_gh_is_installed_with_brew
  test_case "gh is installed with winget" test_gh_is_installed_with_winget
  test_case "gh is installed with apt when sudo needs no password" test_gh_is_installed_with_apt_when_sudo_needs_no_password
  test_case "apt is not used when sudo wants a password" test_apt_is_not_used_when_sudo_wants_a_password
  test_case "a failed gh install does not stop the panel" test_a_failed_gh_install_does_not_stop_the_panel
  test_case "gh already there is left alone" test_gh_already_there_is_left_alone
  test_case "dry run shows the gh install without doing it" test_dry_run_shows_the_gh_install_without_doing_it
}

run_all
finish
