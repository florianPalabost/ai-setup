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

test_a_bare_machine_ends_on_the_git_panel() {
  # Arrange: no herdr, no gh, no home, nothing ever opened
  new_repo_copy
  herdr_not_installed
  gh_not_installed

  # Act
  install
  local code=$?

  # Assert
  assert_eq 0 "$code" "exit code"
  assert_eq "1" "$(wc -l <"$HERDR/fake-launches.log" | tr -d ' ')" "launches"
  assert_eq "$REPO_COPY/herdr/mods/git" "$(readlink "$HERDR/mods/git")" "git mod link"
  assert_contains "$REPO_COPY/herdr/mods/git/changes.js" "herdr-version: 0.1.12"
  assert_contains "$HERDR/mods/tabs-git/main.js" 'panelButton("changes", "Git"'
  assert_eq "git" "$(json_get "$HERDR/layouts/main-git.json" '#changes.content.mod')" "changes slot"
  assert_eq "main-git" "$(json_get "$HERDR/shared.json" layout)" "shown layout"
  assert_contains "$OUT" "main-git is active"
}

test_a_rerun_after_a_bare_install_opens_no_window() {
  # Arrange: installed, then the window was closed
  new_repo_copy
  herdr_not_installed
  install
  rm "$HERDR/fake-window" "$HERDR/fake-launches.log" "$SANDBOX/tool-calls.log"

  # Act
  install
  local code=$?

  # Assert
  assert_eq 0 "$code" "exit code"
  assert_no_file "$HERDR/fake-launches.log"
  assert_no_file "$SANDBOX/tool-calls.log"
  assert_contains "$OUT" "main-git is active"
}

test_a_closed_window_is_started_when_the_layout_is_not_active() {
  # Arrange
  new_repo_copy
  herdr_with_window
  rm "$HERDR/fake-window"

  # Act
  install

  # Assert
  assert_file "$HERDR/fake-launches.log"
  assert_eq "main-git" "$(json_get "$HERDR/shared.json" layout)" "shown layout"
}

test_an_open_window_is_not_started_again() {
  # Arrange
  new_repo_copy
  herdr_with_window

  # Act
  install

  # Assert
  assert_no_file "$HERDR/fake-launches.log"
  assert_eq "main-git" "$(json_get "$HERDR/shared.json" layout)" "shown layout"
}

test_missing_shipped_files_start_the_window_even_with_the_layout_active() {
  # Arrange
  new_repo_copy
  herdr_not_installed
  install
  rm "$HERDR/fake-window" "$HERDR/fake-launches.log"
  rm -r "$HERDR/mods/tabs"

  # Act
  install

  # Assert
  assert_file "$HERDR/fake-launches.log"
  assert_file "$HERDR/mods/tabs/main.js"
}

test_a_window_that_never_opens_times_out_and_the_rest_installs() {
  # Arrange
  new_repo_copy
  mkdir -p "$HERDR"
  touch "$HERDR/fake-window-never-opens"

  # Act
  install
  local code=$?

  # Assert
  assert_eq 0 "$code" "exit code"
  assert_contains "$OUT" "herdr didn't answer"
  assert_eq "$REPO_COPY/herdr/mods/git" "$(readlink "$HERDR/mods/git")" "git mod link"
  assert_no_file "$HERDR/mods/tabs-git"
  assert_contains "$OUT" "Done"
}

test_a_status_that_hangs_times_out_without_a_second_window() {
  # Arrange: a window is up but stuck, as the real one is while it starts
  new_repo_copy
  herdr_with_window
  touch "$HERDR/fake-status-hangs"
  local started=$SECONDS

  # Act
  install
  local code=$?

  # Assert
  assert_eq 0 "$code" "exit code"
  assert_contains "$OUT" "herdr didn't answer"
  assert_no_file "$HERDR/fake-launches.log"
  ((SECONDS - started < 30)) || fail "took $((SECONDS - started))s: the hang was not cut short"
}

test_dry_run_on_a_bare_machine_shows_every_step() {
  # Arrange
  new_repo_copy
  herdr_not_installed
  gh_not_installed
  give_tools brew
  local before
  before="$(tree_state)"

  # Act
  install --dry-run
  local code=$?

  # Assert
  assert_eq 0 "$code" "exit code"
  assert_eq "$before" "$(tree_state)" "home"
  assert_no_file "$SANDBOX/tool-calls.log"
  assert_no_file "$HERDR"
  assert_no_file "$REPO_COPY/herdr/mods/git/changes.js"
  assert_contains "$OUT" "would install herdr from https://releases.herdr.dev/app/install.sh"
  assert_contains "$OUT" "[dry-run] brew install gh"
  assert_contains "$OUT" "[dry-run] ln -s $REPO_COPY/herdr/mods/git $HERDR/mods/git"
  assert_contains "$OUT" "would start herdr and poll"
  assert_contains "$OUT" "would generate $REPO_COPY/herdr/mods/git/changes.js"
  assert_contains "$OUT" '[dry-run] herdr-app do mod.clone {"name":"tabs","as":"tabs-git"}'
  assert_contains "$OUT" '[dry-run] herdr-app do layout.clone {"name":"main","as":"main-git"}'
  assert_contains "$OUT" '[dry-run] herdr-app do layout.switch {"name":"main-git"}'
}

test_dry_run_with_herdr_never_opened_starts_nothing() {
  # Arrange: herdr is installed, but its home doesn't exist yet
  new_repo_copy
  local before
  before="$(tree_state)"

  # Act
  install --dry-run
  local code=$?

  # Assert
  assert_eq 0 "$code" "exit code"
  assert_eq "$before" "$(tree_state)" "home"
  assert_no_file "$HERDR"
  assert_contains "$OUT" "would start herdr and poll"
  assert_contains "$OUT" '[dry-run] herdr-app do layout.switch {"name":"main-git"}'
}

test_the_run_ends_with_gh_auth_login_when_signed_out() {
  # Arrange
  new_repo_copy
  herdr_with_window
  touch "$SANDBOX/gh-signed-out"

  # Act
  install
  local code=$?

  # Assert
  assert_eq 0 "$code" "exit code"
  assert_contains <(tail -n 1 "$OUT") 'run `gh auth login`'
}

test_nothing_is_said_about_gh_when_signed_in() {
  # Arrange
  new_repo_copy
  herdr_with_window

  # Act
  install

  # Assert
  assert_lacks "$OUT" "gh auth login"
}

test_gh_that_could_not_be_installed_is_named_at_the_end() {
  # Arrange
  new_repo_copy
  herdr_with_window
  gh_not_installed

  # Act
  install
  local code=$?

  # Assert
  assert_eq 0 "$code" "exit code"
  assert_contains <(tail -n 1 "$OUT") 'run `gh auth login`'
  assert_contains <(tail -n 1 "$OUT") "install gh"
}

test_dry_run_ends_with_gh_auth_login_too() {
  # Arrange
  new_repo_copy
  herdr_not_installed
  gh_not_installed

  # Act
  install --dry-run

  # Assert
  assert_contains <(tail -n 1 "$OUT") 'run `gh auth login`'
}

test_a_machine_with_no_display_is_not_told_about_gh() {
  # Arrange: the sign-in only serves the panel, which this machine doesn't get
  new_repo_copy
  gh_not_installed

  # Act
  FAKE_DISPLAY="" install

  # Assert
  assert_lacks "$OUT" "gh auth login"
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
  test_case "a bare machine ends on the Git panel" test_a_bare_machine_ends_on_the_git_panel
  test_case "a re-run after a bare install opens no window" test_a_rerun_after_a_bare_install_opens_no_window
  test_case "a closed window is started when the layout is not active" test_a_closed_window_is_started_when_the_layout_is_not_active
  test_case "an open window is not started again" test_an_open_window_is_not_started_again
  test_case "missing shipped files start the window even with the layout active" test_missing_shipped_files_start_the_window_even_with_the_layout_active
  test_case "a window that never opens times out and the rest installs" test_a_window_that_never_opens_times_out_and_the_rest_installs
  test_case "a status that hangs times out without a second window" test_a_status_that_hangs_times_out_without_a_second_window
  test_case "dry run on a bare machine shows every step" test_dry_run_on_a_bare_machine_shows_every_step
  test_case "dry run with herdr never opened starts nothing" test_dry_run_with_herdr_never_opened_starts_nothing
  test_case "the run ends with gh auth login when signed out" test_the_run_ends_with_gh_auth_login_when_signed_out
  test_case "nothing is said about gh when signed in" test_nothing_is_said_about_gh_when_signed_in
  test_case "gh that could not be installed is named at the end" test_gh_that_could_not_be_installed_is_named_at_the_end
  test_case "dry run ends with gh auth login too" test_dry_run_ends_with_gh_auth_login_too
  test_case "a machine with no display is not told about gh" test_a_machine_with_no_display_is_not_told_about_gh
}

run_all
finish
