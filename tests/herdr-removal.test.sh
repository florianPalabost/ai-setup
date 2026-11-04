#!/usr/bin/env bash
# Dropped herdr mods and clones going through the leftover check. See
# tests/helpers.sh for the isolation.

# shellcheck source=tests/helpers.sh
source "$(dirname "${BASH_SOURCE[0]}")/helpers.sh"

DROPPED_MODS=(proto-git proto-graph-community proto-pr-pane proto-prs-panel tabs-proto)

# A machine like the reference one: prototypes installed by hand, main-proto showing.
herdr_with_prototypes() {
  local name
  herdr_with_window
  for name in "${DROPPED_MODS[@]}"; do
    mkdir -p "$HERDR/mods/$name"
    printf '{ "place": "none" }' >"$HERDR/mods/$name/mod.json"
  done
  printf '{"cloned_from":{"name":"main","version":"0.1.11"}}' >"$HERDR/layouts/main-proto.json"
  printf '{"layout":"main-proto"}' >"$HERDR/shared.json"
}

# Runs the install on a terminal, typing $1 at the leftover prompt, and leaves its
# output in $OUT. The prompt only appears on a terminal.
install_answering() {
  OUT="$SANDBOX/out"
  in_sandbox python3 -c '
import os, pty, select, sys, time

TIMEOUT_SECONDS = 120

reply, command = sys.argv[1], sys.argv[2:]
pid, terminal = pty.fork()
if pid == 0:
    os.execvp(command[0], command)
seen, answered, deadline = b"", False, time.time() + TIMEOUT_SECONDS
while time.time() < deadline:
    if select.select([terminal], [], [], 1)[0]:
        try:
            chunk = os.read(terminal, 4096)
        except OSError:
            break
        if not chunk:
            break
        seen += chunk
        if not answered and b"Remove these?" in seen:
            os.write(terminal, reply.encode() + b"\n")
            answered = True
sys.stdout.write(seen.decode(errors="replace"))
sys.exit(os.waitstatus_to_exitcode(os.waitpid(pid, 0)[1]))
' "$1" bash "$REPO_COPY/install.sh" </dev/null >"$OUT" 2>&1
}

# The backup of the path $1, under whichever timestamped dir this run used.
backup_of() {
  local found
  for found in "$SANDBOX_HOME"/.claude/backups/ai-setup-*/"${1#"$SANDBOX_HOME"/}"; do
    printf '%s' "$found"
  done
}

assert_prototypes_listed() {
  local name
  for name in "${DROPPED_MODS[@]}"; do
    assert_contains "$OUT" "herdr-mod  $HERDR/mods/$name"
  done
  assert_contains "$OUT" "herdr-layout  $HERDR/layouts/main-proto.json"
}

assert_prototypes_in_place() {
  local name
  for name in "${DROPPED_MODS[@]}"; do
    assert_file "$HERDR/mods/$name/mod.json"
  done
  assert_file "$HERDR/layouts/main-proto.json"
}

test_the_leftover_check_lists_the_prototypes() {
  # Arrange
  new_repo_copy
  herdr_with_prototypes

  # Act
  install
  local code=$?

  # Assert
  assert_eq 0 "$code" "exit code"
  assert_prototypes_listed
}

test_without_a_terminal_they_are_kept() {
  # Arrange
  new_repo_copy
  herdr_with_prototypes

  # Act
  install

  # Assert
  assert_contains "$OUT" "not a terminal, keeping them"
  assert_prototypes_in_place
}

test_answering_no_keeps_them() {
  # Arrange
  new_repo_copy
  herdr_with_prototypes

  # Act
  install_answering n

  # Assert
  assert_contains "$OUT" "kept"
  assert_prototypes_in_place
}

test_answering_yes_moves_them_to_the_backup() {
  # Arrange
  new_repo_copy
  herdr_with_prototypes

  # Act
  install_answering y
  local code=$?

  # Assert
  assert_eq 0 "$code" "exit code"
  local name
  for name in "${DROPPED_MODS[@]}"; do
    assert_no_file "$HERDR/mods/$name"
    assert_file "$(backup_of "$HERDR/mods/$name")/mod.json"
  done
  assert_no_file "$HERDR/layouts/main-proto.json"
  assert_file "$(backup_of "$HERDR/layouts/main-proto.json")"
  assert_eq "main-git" "$(json_get "$HERDR/shared.json" layout)" "shown layout"
}

# A herdr release that touched our edit, so install can't build the Git layout
# and leaves main-proto showing.
leave_the_git_layout_unbuildable() {
  printf '// upstream rewrote the tab bar\n' >"$HERDR/mods/tabs/main.js"
}

test_yes_with_no_git_layout_switches_to_main_first() {
  # Arrange
  new_repo_copy
  herdr_with_prototypes
  leave_the_git_layout_unbuildable

  # Act
  install_answering y

  # Assert
  assert_contains "$HERDR/fake-calls.log" 'layout.switch {"name":"main"}'
  assert_eq "main" "$(json_get "$HERDR/shared.json" layout)" "shown layout"
  assert_no_file "$HERDR/layouts/main-proto.json"
  assert_no_file "$HERDR/mods/proto-git"
}

test_leaving_a_dropped_layout_prefers_the_git_layout() {
  # Arrange
  new_repo_copy
  herdr_with_prototypes
  install
  printf '{"layout":"main-proto"}' >"$HERDR/shared.json"

  # Act
  install_function herdr_leave_dropped_layout "$(printf 'herdr-layout\t%s' "$HERDR/layouts/main-proto.json")"
  local code=$?

  # Assert
  assert_eq 0 "$code" "exit code"
  assert_eq "main-git" "$(json_get "$HERDR/shared.json" layout)" "shown layout"
}

test_a_switch_that_does_not_land_keeps_all_herdr_files() {
  # Arrange: herdr answers ok to layout.switch whether or not it switched
  new_repo_copy
  herdr_with_prototypes
  leave_the_git_layout_unbuildable
  touch "$HERDR/fake-layout.switch-ignored"

  # Act
  install_answering y
  local code=$?

  # Assert
  assert_eq 0 "$code" "exit code"
  assert_prototypes_in_place
  assert_contains "$OUT" "herdr still shows main-proto"
}

test_a_refused_switch_keeps_all_herdr_files() {
  # Arrange
  new_repo_copy
  herdr_with_prototypes
  leave_the_git_layout_unbuildable
  touch "$HERDR/fake-layout.switch-fails"

  # Act
  install_answering y
  local code=$?

  # Assert
  assert_eq 0 "$code" "exit code"
  assert_prototypes_in_place
  assert_contains "$OUT" "herdr could not switch away from main-proto"
}

test_with_no_window_a_showing_layout_is_kept() {
  # Arrange: closed, and install's attempt to open it fails
  new_repo_copy
  herdr_with_prototypes
  rm "$HERDR/fake-window"
  touch "$HERDR/fake-window-never-opens"

  # Act
  install_answering y
  local code=$?

  # Assert
  assert_eq 0 "$code" "exit code"
  assert_prototypes_in_place
  assert_contains "$OUT" "main-proto is showing and herdr isn't open"
}

test_with_herdr_closed_and_another_layout_showing_they_are_removed() {
  # Arrange
  new_repo_copy
  herdr_with_prototypes
  printf '{"layout":"main"}' >"$HERDR/shared.json"
  rm "$HERDR/fake-window"

  # Act
  install_answering y

  # Assert
  assert_no_file "$HERDR/layouts/main-proto.json"
  assert_no_file "$HERDR/mods/tabs-proto"
}

test_shipped_names_are_never_listed() {
  # Arrange: a later herdr release ships names the repo dropped
  new_repo_copy
  herdr_with_prototypes
  printf '{"tabs-proto":{},"layout:main-proto":{},"tabs":{},"layout:main":{}}' >"$HERDR/installed.json"
  printf '{"layout":"main"}' >"$HERDR/shared.json"

  # Act
  install_answering y

  # Assert
  assert_lacks "$OUT" "herdr-mod  $HERDR/mods/tabs-proto"
  assert_lacks "$OUT" "herdr-layout  $HERDR/layouts/main-proto.json"
  assert_contains "$OUT" "herdr-mod  $HERDR/mods/proto-git"
  assert_file "$HERDR/mods/tabs-proto/mod.json"
  assert_file "$HERDR/layouts/main-proto.json"
}

test_machine_local_files_are_never_listed() {
  # Arrange
  new_repo_copy
  herdr_with_prototypes
  mkdir -p "$HERDR/mods/my-own" "$HERDR/mods/tabs-edited" "$HERDR/data/proto-git" "$HERDR/layouts/.state"
  printf '{"cloned_from":{"name":"tabs","version":"0.1.12"}}' >"$HERDR/mods/my-own/mod.json"
  printf '{}' >"$HERDR/layouts/my-layout.json"
  printf '{}' >"$HERDR/layouts/.state/main-proto.json"
  printf '{}' >"$HERDR/data/proto-git/state.json"
  printf '{}' >"$HERDR/keys.json"
  printf '{}' >"$HERDR/settings.json"

  # Act
  install_answering y

  # Assert: the list holds the prototypes and nothing else
  local expected listed path
  expected="$(printf '%s\n' layouts/main-proto.json mods/proto-git mods/proto-graph-community \
    mods/proto-pr-pane mods/proto-prs-panel mods/tabs-proto)"
  listed="$(tr -d '\r' <"$OUT" | sed -n "s#^ *herdr-[a-z]*  $HERDR/##p" | LC_ALL=C sort)"
  assert_eq "$expected" "$listed" "listed"
  for path in mods/my-own mods/tabs-edited mods/tabs mods/changes mods/git mods/tabs-git layouts/my-layout.json \
    layouts/main.json layouts/main-git.json layouts/.state/main-proto.json data/proto-git/state.json \
    keys.json settings.json shared.json; do
    assert_file "$HERDR/$path"
  done
}

test_a_link_left_by_a_removed_own_mod_is_listed() {
  # Arrange: dangling links, one into this repo and one someone else's
  new_repo_copy
  herdr_with_window
  mkdir -p "$HERDR/mods"
  ln -s "$REPO_COPY/herdr/mods/gone" "$HERDR/mods/gone"
  ln -s "/elsewhere/mod" "$HERDR/mods/elsewhere"

  # Act
  install_answering y

  # Assert
  assert_contains "$OUT" "herdr-mod  $HERDR/mods/gone"
  assert_no_file "$HERDR/mods/gone"
  assert_lacks "$OUT" "herdr-mod  $HERDR/mods/elsewhere"
  assert_eq "/elsewhere/mod" "$(readlink "$HERDR/mods/elsewhere")" "someone else's link"
}

test_dry_run_lists_them_and_changes_nothing() {
  # Arrange
  new_repo_copy
  herdr_with_prototypes
  local before
  before="$(tree_state)"

  # Act
  install --dry-run
  local code=$?

  # Assert
  assert_eq 0 "$code" "exit code"
  assert_prototypes_listed
  assert_contains "$OUT" "[dry-run] would ask to remove these"
  assert_contains "$OUT" "main-proto is showing"
  assert_eq "$before" "$(tree_state)" "home"
  assert_no_file "$HERDR/fake-calls.log"
}

test_dry_run_on_a_terminal_does_not_ask() {
  # Arrange
  new_repo_copy
  herdr_with_prototypes
  local before
  before="$(tree_state)"

  # Act
  OUT="$SANDBOX/out"
  in_sandbox python3 -c 'import pty, sys; pty.spawn(sys.argv[1:])' bash "$REPO_COPY/install.sh" --dry-run </dev/null >"$OUT" 2>&1

  # Assert
  assert_lacks "$OUT" "Remove these?"
  assert_prototypes_listed
  assert_eq "$before" "$(tree_state)" "home"
}

run_all() {
  test_case "the leftover check lists the prototypes" test_the_leftover_check_lists_the_prototypes
  test_case "without a terminal they are kept" test_without_a_terminal_they_are_kept
  test_case "answering no keeps them" test_answering_no_keeps_them
  test_case "answering yes moves them to the backup" test_answering_yes_moves_them_to_the_backup
  test_case "yes with no Git layout switches to main first" test_yes_with_no_git_layout_switches_to_main_first
  test_case "leaving a dropped layout prefers the Git layout" test_leaving_a_dropped_layout_prefers_the_git_layout
  test_case "a switch that does not land keeps all herdr files" test_a_switch_that_does_not_land_keeps_all_herdr_files
  test_case "a refused switch keeps all herdr files" test_a_refused_switch_keeps_all_herdr_files
  test_case "with no window a showing layout is kept" test_with_no_window_a_showing_layout_is_kept
  test_case "with herdr closed and another layout showing they are removed" test_with_herdr_closed_and_another_layout_showing_they_are_removed
  test_case "shipped names are never listed" test_shipped_names_are_never_listed
  test_case "machine-local files are never listed" test_machine_local_files_are_never_listed
  test_case "a link left by a removed own mod is listed" test_a_link_left_by_a_removed_own_mod_is_listed
  test_case "dry run lists them and changes nothing" test_dry_run_lists_them_and_changes_nothing
  test_case "dry run on a terminal does not ask" test_dry_run_on_a_terminal_does_not_ask
}

run_all
finish
