#!/usr/bin/env bash
# What lets one install.sh run on Linux, macOS and Git Bash on native Windows.

# shellcheck source=tests/helpers.sh
source "$(dirname "${BASH_SOURCE[0]}")/helpers.sh"

REAL_PYTHON="$(command -v python3)"
WINDOWS_UNAME=MINGW64_NT-10.0-19045

# Windows' Store stub: on PATH, runs, and fails.
python_stub() {
  printf '#!/bin/sh\necho "Python was not found" >&2\nexit 9\n' >"$SANDBOX/bin/$1"
  chmod +x "$SANDBOX/bin/$1"
}

# Like Python on Windows: ends every line it prints with \r\n.
python3_with_crlf() {
  printf '#!/bin/sh\n"%s" "$@" | /bin/sed "s/\$/\\r/"\n' "$REAL_PYTHON" >"$SANDBOX/bin/python3"
  chmod +x "$SANDBOX/bin/python3"
}

on_windows() {
  FAKE_UNAME="$WINDOWS_UNAME"
  give_tools ln cmd cygpath
}

test_python_is_used_when_python3_is_only_a_stub() {
  # Arrange
  new_repo_copy
  python_stub python3
  ln -s "$REAL_PYTHON" "$SANDBOX/bin/python"

  # Act
  install_function merge_settings
  local code=$?

  # Assert
  assert_eq 0 "$code" "exit code"
  assert_file "$SANDBOX_HOME/.claude/settings.json"
  assert_lacks "$OUT" "not found"
}

test_no_working_python_skips_the_step_with_a_warning() {
  # Arrange
  new_repo_copy
  python_stub python3
  python_stub python

  # Act
  install_function merge_settings
  local code=$?

  # Assert
  assert_eq 0 "$code" "exit code"
  assert_contains "$OUT" "'python3' not found, skipping: settings merge"
  assert_no_file "$SANDBOX_HOME/.claude/settings.json"
}

test_crlf_from_python_does_not_reach_the_script() {
  # Arrange
  new_repo_copy
  python3_with_crlf
  mkdir -p "$HERDR"
  printf '{"layout":"main-git"}' >"$HERDR/shared.json"

  # Act
  install_function herdr_shown_layout

  # Assert
  assert_eq "main-git" "$(cat "$OUT")" "layout"
}

test_python_failure_still_reaches_the_caller() {
  # Arrange
  new_repo_copy
  mkdir -p "$SANDBOX/layouts"
  printf '{"id":"root"}' >"$SANDBOX/layouts/layout.json"
  printf '{"blocks":{"missing":{"from":"a","to":"b"}}}' >"$SANDBOX/layouts/edit.json"

  # Act
  install_function layout_edit_applies "$SANDBOX/layouts/layout.json" "$SANDBOX/layouts/edit.json"
  local code=$?

  # Assert
  assert_eq 1 "$code" "exit code"
}

test_windows_link_uses_a_native_symlink_when_permitted() {
  # Arrange
  new_repo_copy
  on_windows
  mkdir -p "$SANDBOX/src"
  local dst="$SANDBOX_HOME/dst"

  # Act
  install_function link "$SANDBOX/src" "$dst"

  # Assert
  assert_eq "$SANDBOX/src" "$(readlink "$dst")" "link target"
  assert_contains "$SANDBOX/tool-calls.log" "MSYS=winsymlinks:nativestrict"
  assert_lacks "$SANDBOX/tool-calls.log" "mklink"
  assert_lacks "$OUT" "re-run"
}

test_windows_folder_falls_back_to_a_junction() {
  # Arrange
  new_repo_copy
  on_windows
  touch "$SANDBOX/symlinks-refused"
  mkdir -p "$SANDBOX/src"
  local dst="$SANDBOX_HOME/dst"

  # Act
  install_function link "$SANDBOX/src" "$dst"
  local code=$?

  # Assert
  assert_eq 0 "$code" "exit code"
  assert_contains "$SANDBOX/tool-calls.log" "cmd //c mklink //J $dst $SANDBOX/src"
  assert_eq "$SANDBOX/src" "$(readlink "$dst")" "junction target"
  assert_lacks "$OUT" "re-run"
  assert_lacks "$OUT" "Junction created"
}

test_windows_file_falls_back_to_a_copy_with_a_warning() {
  # Arrange
  new_repo_copy
  on_windows
  touch "$SANDBOX/symlinks-refused"
  printf 'one\n' >"$SANDBOX/src.md"
  local dst="$SANDBOX_HOME/dst.md"

  # Act
  install_function link "$SANDBOX/src.md" "$dst"
  local code=$?

  # Assert
  assert_eq 0 "$code" "exit code"
  assert_eq "one" "$(cat "$dst")" "copy"
  [[ ! -L "$dst" ]] || fail "expected a copy, found a link"
  assert_contains "$OUT" "re-run install to refresh"
}

test_windows_rerun_leaves_an_unchanged_copy_alone() {
  # Arrange
  new_repo_copy
  on_windows
  touch "$SANDBOX/symlinks-refused"
  printf 'one\n' >"$SANDBOX/src.md"
  local dst="$SANDBOX_HOME/dst.md"
  install_function link "$SANDBOX/src.md" "$dst"

  # Act
  install_function link "$SANDBOX/src.md" "$dst"

  # Assert
  assert_lacks "$OUT" "backed up"
  assert_lacks "$OUT" "re-run"
  assert_no_file "$SANDBOX_HOME/.claude/backups"
}

test_windows_rerun_refreshes_a_stale_copy_and_keeps_the_old_one() {
  # Arrange
  new_repo_copy
  on_windows
  touch "$SANDBOX/symlinks-refused"
  printf 'one\n' >"$SANDBOX/src.md"
  local dst="$SANDBOX_HOME/dst.md"
  install_function link "$SANDBOX/src.md" "$dst"
  printf 'two\n' >"$SANDBOX/src.md"

  # Act
  install_function link "$SANDBOX/src.md" "$dst"

  # Assert
  assert_eq "two" "$(cat "$dst")" "copy"
  assert_contains "$OUT" "backed up"
  assert_eq "one" "$(cat "$SANDBOX_HOME"/.claude/backups/*/dst.md)" "backup"
}

test_windows_refused_junction_warns_and_carries_on() {
  # Arrange
  new_repo_copy
  on_windows
  touch "$SANDBOX/symlinks-refused" "$SANDBOX/junctions-refused"
  mkdir -p "$SANDBOX/src"
  local dst="$SANDBOX_HOME/dst"

  # Act
  install_function link "$SANDBOX/src" "$dst"
  local code=$?

  # Assert
  assert_eq 0 "$code" "exit code"
  assert_contains "$OUT" "could not link $dst"
  assert_lacks "$OUT" "linked $dst"
}

test_windows_mirror_entries_fall_back_too() {
  # Arrange
  new_repo_copy
  on_windows
  touch "$SANDBOX/symlinks-refused"
  printf 'one\n' >"$SANDBOX/entry.md"
  local dst="$SANDBOX_HOME/entry.md"

  # Act
  install_function mirror_link "$SANDBOX/entry.md" "$dst"

  # Assert
  assert_eq "one" "$(cat "$dst")" "copy"
}

test_windows_dry_run_makes_no_link() {
  # Arrange
  new_repo_copy
  on_windows
  mkdir -p "$SANDBOX/src"
  local dst="$SANDBOX_HOME/dst"

  # Act
  install_function_dry_run link "$SANDBOX/src" "$dst"

  # Assert
  assert_contains "$OUT" "[dry-run] ln -s $SANDBOX/src $dst"
  assert_no_file "$dst"
  assert_no_file "$SANDBOX/tool-calls.log"
}

test_linux_link_ignores_the_windows_fallbacks() {
  # Arrange
  new_repo_copy
  FAKE_UNAME=Linux
  give_tools ln cmd cygpath
  touch "$SANDBOX/symlinks-refused"
  mkdir -p "$SANDBOX/src"

  # Act
  install_function link "$SANDBOX/src" "$SANDBOX_HOME/dst"
  local code=$?

  # Assert
  assert_eq 1 "$code" "exit code"
  assert_lacks "$SANDBOX/tool-calls.log" "mklink"
}

test_windows_leftover_paths_from_python_become_posix_paths() {
  # Arrange
  new_repo_copy
  on_windows
  local entries
  entries="$(printf 'rule:allow\tBash(C:\\x)\nherdr-mod\tC:\\Users\\me\\mods\\old')"

  # Act
  install_function posix_entries "$entries"

  # Assert
  assert_contains "$OUT" "$(printf 'rule:allow\tBash(C:\\x)')"
  assert_contains "$OUT" "$(printf 'herdr-mod\t/c/Users/me/mods/old')"
}

test_shell_is_free_of_bash_4_features() {
  # Arrange
  local pattern='declare -A|local -A|mapfile|readarray|coproc|globstar|local -n|declare -n|&>>|\|&|\$\{[A-Za-z_]+(,,|\^\^|,|\^)\}'

  # Act
  local found
  found="$(grep -nE "$pattern" "$REPO/install.sh" "$REPO/lib.sh" "$REPO/herdr.sh")"

  # Assert
  assert_eq "" "$found" "bash 4 features"
}

test_scripts_keep_lf_line_endings_on_a_windows_checkout() {
  # Arrange
  local paths=(install.sh lib.sh herdr.sh manifests/skills.txt herdr/patches/tabs.patch herdr/mods/git/main.js)

  for path in "${paths[@]}"; do
    # Act
    local eol
    eol="$("$REAL_GIT" -C "$REPO" check-attr eol -- "$path")"

    # Assert
    assert_eq "$path: eol: lf" "$eol" "line endings"
  done
}

test_install_ps1_stays_ascii_for_windows_powershell() {
  # Arrange: Windows PowerShell reads a script with no BOM as the local code page.

  # Act
  local found
  found="$(LC_ALL=C grep -n '[^[:print:][:space:]]' "$REPO/install.ps1")"

  # Assert
  assert_eq "" "$found" "non-ASCII lines"
}

test_case "install.ps1 stays ASCII for Windows PowerShell" test_install_ps1_stays_ascii_for_windows_powershell
test_case "python is used when python3 is only a stub" test_python_is_used_when_python3_is_only_a_stub
test_case "no working python skips the step with a warning" test_no_working_python_skips_the_step_with_a_warning
test_case "CRLF from python does not reach the script" test_crlf_from_python_does_not_reach_the_script
test_case "a python failure still reaches the caller" test_python_failure_still_reaches_the_caller
test_case "Windows link uses a native symlink when permitted" test_windows_link_uses_a_native_symlink_when_permitted
test_case "Windows folder falls back to a junction" test_windows_folder_falls_back_to_a_junction
test_case "Windows file falls back to a copy with a warning" test_windows_file_falls_back_to_a_copy_with_a_warning
test_case "Windows re-run leaves an unchanged copy alone" test_windows_rerun_leaves_an_unchanged_copy_alone
test_case "Windows re-run refreshes a stale copy and keeps the old one" test_windows_rerun_refreshes_a_stale_copy_and_keeps_the_old_one
test_case "Windows refused junction warns and carries on" test_windows_refused_junction_warns_and_carries_on
test_case "Windows mirror entries fall back too" test_windows_mirror_entries_fall_back_too
test_case "Windows dry run makes no link" test_windows_dry_run_makes_no_link
test_case "Linux link ignores the Windows fallbacks" test_linux_link_ignores_the_windows_fallbacks
test_case "Windows leftover paths from python become POSIX paths" test_windows_leftover_paths_from_python_become_posix_paths
test_case "the install shell is free of bash 4 features" test_shell_is_free_of_bash_4_features
test_case "scripts keep LF line endings on a Windows checkout" test_scripts_keep_lf_line_endings_on_a_windows_checkout
finish
