#!/usr/bin/env bash
# install.ps1, run under pwsh with fakes for Git Bash, winget and Python. Its
# install.sh is the fake bash.exe, so this covers only the PowerShell. Skipped
# where pwsh isn't on PATH, which GitHub's Linux runners do have.

# shellcheck source=tests/helpers.sh
source "$(dirname "${BASH_SOURCE[0]}")/helpers.sh"

PWSH="$(command -v pwsh || true)"
if [[ -z "$PWSH" ]]; then
  echo "skipped: pwsh not on PATH, install.ps1 not exercised"
  finish
  exit 0
fi

EXIT_FROM_INSTALL_SH=7

executable() {
  printf '#!/bin/sh\n%s\n' "$2" >"$1"
  chmod +x "$1"
}

# <root>/cmd/git and <root>/bin/bash.exe, as Git for Windows lays them out. The
# fake bash.exe logs its arguments.
git_for_windows_at() {
  mkdir -p "$1/cmd" "$1/bin"
  executable "$1/cmd/git" 'exit 0'
  executable "$1/bin/bash.exe" "echo \"bash.exe \$*\" >>\"$SANDBOX/calls.log\"; exit \${FAKE_BASH_EXIT:-0}"
}

git_bash_on_path() {
  git_for_windows_at "$SANDBOX/Git"
  PS_PATH="$SANDBOX/Git/cmd:$PS_PATH"
}

working_python() {
  executable "$SANDBOX/bin/python" 'exit 0'
}

# A winget that logs its arguments and, like the real one, adds nothing to this
# session's PATH by itself: the files appear where the next search looks.
winget_available() {
  executable "$SANDBOX/bin/winget" "echo \"winget \$*\" >>\"$SANDBOX/calls.log\"; case \"\$*\" in *Python*) printf '#!/bin/sh\nexit 0\n' >\"$SANDBOX/bin/python\"; /bin/chmod +x \"$SANDBOX/bin/python\" ;; esac"
}

# Runs install.ps1 with nothing on PATH but what the test put there.
install_ps1() {
  OUT="$SANDBOX/out"
  env -i HOME="$SANDBOX_HOME" PATH="$PS_PATH" LOCALAPPDATA="$SANDBOX/LocalAppData" \
    FAKE_BASH_EXIT="${FAKE_BASH_EXIT:-0}" \
    "$PWSH" -NoProfile -NonInteractive -File "$REPO/install.ps1" "$@" </dev/null >"$OUT" 2>&1
}

arrange() {
  PS_PATH="$SANDBOX/bin"
  FAKE_BASH_EXIT=0
  rm -f "$SANDBOX"/bin/*
}

test_dry_run_passes_the_flag_to_install_sh() {
  # Arrange
  arrange
  git_bash_on_path
  working_python

  # Act
  install_ps1 -DryRun
  local code=$?

  # Assert
  assert_eq 0 "$code" "exit code"
  assert_contains "$SANDBOX/calls.log" "bash.exe $REPO/install.sh --dry-run"
}

test_update_is_passed_on_and_a_plain_run_adds_nothing() {
  # Arrange
  arrange
  git_bash_on_path
  working_python

  # Act
  install_ps1 -Update

  # Assert
  assert_contains "$SANDBOX/calls.log" "bash.exe $REPO/install.sh --update"
  assert_lacks "$SANDBOX/calls.log" "--dry-run"
}

test_a_failing_install_sh_fails_the_run() {
  # Arrange
  arrange
  git_bash_on_path
  working_python
  FAKE_BASH_EXIT=$EXIT_FROM_INSTALL_SH

  # Act
  install_ps1
  local code=$?

  # Assert
  assert_eq "$EXIT_FROM_INSTALL_SH" "$code" "exit code"
}

test_an_unknown_argument_never_becomes_a_real_install() {
  # Arrange
  arrange
  git_bash_on_path
  working_python

  # Act
  install_ps1 --dry-run
  local code=$?

  # Assert
  [[ "$code" != 0 ]] || fail "expected a non-zero exit code"
  assert_no_file "$SANDBOX/calls.log"
}

test_dry_run_with_no_git_installs_nothing() {
  # Arrange
  arrange
  working_python
  winget_available

  # Act
  install_ps1 -DryRun
  local code=$?

  # Assert
  assert_eq 0 "$code" "exit code"
  assert_contains "$OUT" "[dry-run] would install Git for Windows with winget"
  assert_no_file "$SANDBOX/calls.log"
}

test_dry_run_with_no_python_installs_nothing_and_still_runs_install_sh() {
  # Arrange
  arrange
  git_bash_on_path
  winget_available

  # Act
  install_ps1 -DryRun

  # Assert
  assert_contains "$OUT" "[dry-run] would install Python with winget"
  assert_lacks "$SANDBOX/calls.log" "winget"
  assert_contains "$SANDBOX/calls.log" "--dry-run"
}

test_a_store_stub_does_not_count_as_python() {
  # Arrange
  arrange
  git_bash_on_path
  executable "$SANDBOX/bin/python3" 'exit 9'
  winget_available

  # Act
  install_ps1

  # Assert
  assert_contains "$SANDBOX/calls.log" "winget install --id Python.Python.3.13"
}

test_missing_python_is_installed_before_install_sh_runs() {
  # Arrange
  arrange
  git_bash_on_path
  winget_available

  # Act
  install_ps1
  local code=$?

  # Assert
  assert_eq 0 "$code" "exit code"
  assert_eq "winget" "$(head -n 1 "$SANDBOX/calls.log" | cut -d' ' -f1)" "first call"
  assert_contains "$SANDBOX/calls.log" "bash.exe $REPO/install.sh"
}

test_missing_git_with_no_winget_says_what_to_do() {
  # Arrange
  arrange
  working_python

  # Act
  install_ps1
  local code=$?

  # Assert
  assert_eq 1 "$code" "exit code"
  assert_contains "$OUT" "https://git-scm.com/download/win"
}

test_git_bash_is_found_in_the_standard_folder_when_git_is_not_on_path() {
  # Arrange
  arrange
  working_python
  git_for_windows_at "$SANDBOX/LocalAppData/Programs/Git"

  # Act
  install_ps1

  # Assert
  assert_contains "$SANDBOX/calls.log" "bash.exe $REPO/install.sh"
}

test_case "dry run passes the flag to install.sh" test_dry_run_passes_the_flag_to_install_sh
test_case "update is passed on and a plain run adds nothing" test_update_is_passed_on_and_a_plain_run_adds_nothing
test_case "a failing install.sh fails the run" test_a_failing_install_sh_fails_the_run
test_case "an unknown argument never becomes a real install" test_an_unknown_argument_never_becomes_a_real_install
test_case "dry run with no git installs nothing" test_dry_run_with_no_git_installs_nothing
test_case "dry run with no python installs nothing and still runs install.sh" test_dry_run_with_no_python_installs_nothing_and_still_runs_install_sh
test_case "a Store stub does not count as python" test_a_store_stub_does_not_count_as_python
test_case "missing python is installed before install.sh runs" test_missing_python_is_installed_before_install_sh_runs
test_case "missing git with no winget says what to do" test_missing_git_with_no_winget_says_what_to_do
test_case "Git Bash is found in the standard folder when git is not on PATH" test_git_bash_is_found_in_the_standard_folder_when_git_is_not_on_path
finish
