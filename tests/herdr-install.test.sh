#!/usr/bin/env bash
# What one run of install does for herdr. See tests/helpers.sh for the isolation.

# shellcheck source=tests/helpers.sh
source "$(dirname "${BASH_SOURCE[0]}")/helpers.sh"

test_install_builds_the_git_panel() {
  # Arrange
  new_repo_copy
  herdr_with_window

  # Act
  install
  local code=$?

  # Assert
  assert_eq 0 "$code" "exit code"
  assert_eq "$REPO_COPY/herdr/mods/git" "$(readlink "$HERDR/mods/git")" "git mod link"
  assert_contains "$HERDR/mods/tabs-git/main.js" 'panelButton("changes", "Git", "mods/workspace-chrome/git-branch.svg")'
  assert_contains "$HERDR/mods/tabs-git/main.js" 'const enabled = [...(shared("workspace.panels") ?? ["files"]), "changes"];'
  assert_contains "$HERDR/mods/tabs-git/main.js" 'panelButton("files", "Files", "mods/files/file.svg")'
  assert_contains "$HERDR/mods/tabs-git/main.js" 'mods/tabs-git/win-min.svg'
  assert_eq "tabs" "$(json_get "$HERDR/mods/tabs-git/mod.json" cloned_from.name)" "tabs-git cloned_from"
  assert_eq "git" "$(json_get "$HERDR/layouts/main-git.json" '#changes.content.mod')" "changes slot"
  assert_eq "files" "$(json_get "$HERDR/layouts/main-git.json" '#files.content.mod')" "files slot"
  assert_eq "tabs-git" "$(json_get "$HERDR/layouts/main-git.json" '#tabs.content.mod')" "tabs block"
  assert_eq "main" "$(json_get "$HERDR/layouts/main-git.json" cloned_from.name)" "main-git cloned_from"
  assert_eq "main-git" "$(json_get "$HERDR/shared.json" layout)" "shown layout"
  assert_contains "$REPO_COPY/herdr/mods/git/changes.js" "herdr-version: 0.1.12"
  assert_contains "$REPO_COPY/herdr/mods/git/changes.js" "export class Changes {"
  assert_contains "$REPO_COPY/herdr/mods/git/changes.js" "export const key = "
  assert_contains "$REPO_COPY/herdr/mods/git/changes.js" ".when(!this.embedded, (el) => el.child(h_flex().h(42)"
}

test_a_switch_that_does_not_land_is_reported() {
  # Arrange: herdr answers ok to layout.switch whether or not it switched
  new_repo_copy
  herdr_with_window
  install
  printf '{"layout":"main"}' >"$HERDR/shared.json"
  touch "$HERDR/fake-layout.switch-ignored"

  # Act
  install
  local code=$?

  # Assert
  assert_eq 0 "$code" "exit code"
  assert_contains "$OUT" "herdr still shows main, not main-git"
  assert_lacks "$OUT" "main-git is active"
}

test_shipped_files_are_left_alone() {
  # Arrange
  new_repo_copy
  herdr_with_window

  # Act
  install

  # Assert
  cmp -s "$TESTS_DIR/fixtures/shipped/mods/tabs/main.js" "$HERDR/mods/tabs/main.js" || fail "shipped tabs changed"
  cmp -s "$TESTS_DIR/fixtures/shipped/mods/changes/main.js" "$HERDR/mods/changes/main.js" || fail "shipped changes changed"
  cmp -s "$TESTS_DIR/fixtures/shipped/layouts/main.json" "$HERDR/layouts/main.json" || fail "shipped layout changed"
}

test_a_rerun_with_the_layout_active_asks_nothing_of_herdr() {
  # Arrange
  new_repo_copy
  herdr_with_window
  install
  rm "$HERDR/fake-calls.log"
  rm "$HERDR/fake-window"

  # Act
  install
  local code=$?

  # Assert
  assert_eq 0 "$code" "exit code"
  assert_no_file "$HERDR/fake-calls.log"
  assert_eq "main-git" "$(json_get "$HERDR/shared.json" layout)" "shown layout"
}

# What a herdr release that touched our edited lines would look like.
break_shipped_tabs() {
  printf '// upstream rewrote the tab bar\n' >"$HERDR/mods/tabs/main.js"
}

break_shipped_changes() {
  printf '// upstream rewrote the panel\n' >"$HERDR/mods/changes/main.js"
}

# An upstream layout with no `changes` slot, in valid JSON.
break_shipped_layout() {
  printf '{"id":"root","type":"row","children":[{"id":"tabs","type":"block","content":{"mod":"tabs"}}]}' >"$HERDR/layouts/main.json"
}

assert_on_main_with_mods_unused() {
  assert_eq 0 "$1" "exit code"
  assert_eq "main" "$(json_get "$HERDR/shared.json" layout)" "shown layout"
  assert_no_file "$HERDR/layouts/main-git.json"
  assert_eq "$REPO_COPY/herdr/mods/git" "$(readlink "$HERDR/mods/git")" "git mod link"
}

test_tabs_patch_failing_with_no_clone_stays_on_main() {
  # Arrange
  new_repo_copy
  herdr_with_window
  break_shipped_tabs

  # Act
  install
  local code=$?

  # Assert
  assert_on_main_with_mods_unused "$code"
  assert_no_file "$HERDR/mods/tabs-git"
  assert_contains "$OUT" "herdr/patches/tabs.patch no longer applies to herdr 0.1.12"
  assert_contains "$OUT" "staying on the current layout"
}

test_changes_patch_failing_with_no_earlier_code_stays_on_main() {
  # Arrange
  new_repo_copy
  herdr_with_window
  break_shipped_changes

  # Act
  install
  local code=$?

  # Assert
  assert_on_main_with_mods_unused "$code"
  assert_no_file "$REPO_COPY/herdr/mods/git/changes.js"
  assert_contains "$OUT" "herdr/patches/changes.patch no longer applies"
}

test_layout_edit_failing_with_no_clone_stays_on_main() {
  # Arrange
  new_repo_copy
  herdr_with_window
  break_shipped_layout

  # Act
  install
  local code=$?

  # Assert
  assert_on_main_with_mods_unused "$code"
  assert_contains "$OUT" "herdr/patches/main-layout.json no longer applies"
}

test_a_failing_rebuild_keeps_the_last_good_mod_clone() {
  # Arrange
  new_repo_copy
  herdr_with_window
  install
  local good
  good="$(cksum <"$HERDR/mods/tabs-git/main.js")"
  break_shipped_tabs

  # Act
  install_function build_mod_clone tabs tabs-git tabs.patch
  local code=$?

  # Assert
  assert_eq 1 "$code" "exit code"
  assert_eq "$good" "$(cksum <"$HERDR/mods/tabs-git/main.js")" "tabs-git"
  assert_contains "$OUT" "keeping the last good tabs-git"
}

test_a_rebuild_replaces_the_clone_when_the_patch_applies() {
  # Arrange
  new_repo_copy
  herdr_with_window
  install
  FAKE_HERDR_VERSION=0.1.13

  # Act
  install_function build_mod_clone tabs tabs-git tabs.patch
  local code=$?
  unset FAKE_HERDR_VERSION

  # Assert
  assert_eq 0 "$code" "exit code"
  assert_eq "0.1.13" "$(json_get "$HERDR/mods/tabs-git/mod.json" cloned_from.version)" "clone version"
  assert_contains "$HERDR/mods/tabs-git/main.js" 'panelButton("changes", "Git"'
}

test_a_failing_rebuild_keeps_the_last_good_changes_code() {
  # Arrange
  new_repo_copy
  herdr_with_window
  install
  local good
  good="$(cksum <"$REPO_COPY/herdr/mods/git/changes.js")"
  break_shipped_changes

  # Act
  install_function build_changes
  local code=$?

  # Assert
  assert_eq 1 "$code" "exit code"
  assert_eq "$good" "$(cksum <"$REPO_COPY/herdr/mods/git/changes.js")" "changes.js"
  assert_contains "$OUT" "keeping the last good Changes code"
}

test_a_failing_rebuild_keeps_the_last_good_layout_clone() {
  # Arrange
  new_repo_copy
  herdr_with_window
  install
  local good
  good="$(cksum <"$HERDR/layouts/main-git.json")"
  break_shipped_layout

  # Act
  install_function build_layout
  local code=$?

  # Assert
  assert_eq 1 "$code" "exit code"
  assert_eq "$good" "$(cksum <"$HERDR/layouts/main-git.json")" "main-git"
  assert_eq "main-git" "$(json_get "$HERDR/shared.json" layout)" "shown layout"
  assert_contains "$OUT" "keeping the last good main-git"
}

test_a_refused_clone_puts_the_last_good_one_back() {
  # Arrange
  new_repo_copy
  herdr_with_window
  install
  local good_mod good_layout
  good_mod="$(cksum <"$HERDR/mods/tabs-git/main.js")"
  good_layout="$(cksum <"$HERDR/layouts/main-git.json")"
  touch "$HERDR/fake-mod.clone-fails" "$HERDR/fake-layout.clone-fails"

  # Act
  install_function build_mod_clone tabs tabs-git tabs.patch
  local mod_code=$?
  install_function build_layout
  local layout_code=$?

  # Assert
  assert_eq 1 "$mod_code" "mod exit code"
  assert_eq 1 "$layout_code" "layout exit code"
  assert_eq "$good_mod" "$(cksum <"$HERDR/mods/tabs-git/main.js")" "tabs-git"
  assert_eq "$good_layout" "$(cksum <"$HERDR/layouts/main-git.json")" "main-git"
}

test_dry_run_changes_nothing() {
  # Arrange
  new_repo_copy
  herdr_with_window
  local before
  before="$(tree_state)"

  # Act
  install --dry-run
  local code=$?

  # Assert
  assert_eq 0 "$code" "exit code"
  assert_eq "$before" "$(tree_state)" "home"
  assert_no_file "$REPO_COPY/herdr/mods/git/changes.js"
  assert_no_file "$HERDR/fake-calls.log"
  assert_contains "$OUT" "[dry-run] ln -s $REPO_COPY/herdr/mods/git $HERDR/mods/git"
  assert_contains "$OUT" "would generate $REPO_COPY/herdr/mods/git/changes.js from herdr 0.1.12"
  assert_contains "$OUT" '[dry-run] herdr-app do mod.clone {"name":"tabs","as":"tabs-git"}'
  assert_contains "$OUT" '[dry-run] herdr-app do layout.clone {"name":"main","as":"main-git"}'
  assert_contains "$OUT" '[dry-run] herdr-app do layout.switch {"name":"main-git"}'
}

test_dry_run_reports_a_failing_patch() {
  # Arrange
  new_repo_copy
  herdr_with_window
  break_shipped_tabs
  local before
  before="$(tree_state)"

  # Act
  install --dry-run
  local code=$?

  # Assert
  assert_eq 0 "$code" "exit code"
  assert_eq "$before" "$(tree_state)" "home"
  assert_contains "$OUT" "herdr/patches/tabs.patch no longer applies"
  assert_lacks "$OUT" "layout.switch"
}

test_with_herdr_closed_it_links_and_generates_but_runs_no_commands() {
  # Arrange
  new_repo_copy
  herdr_with_window
  rm "$HERDR/fake-window"

  # Act
  install
  local code=$?

  # Assert
  assert_eq 0 "$code" "exit code"
  assert_eq "$REPO_COPY/herdr/mods/git" "$(readlink "$HERDR/mods/git")" "git mod link"
  assert_file "$REPO_COPY/herdr/mods/git/changes.js"
  assert_no_file "$HERDR/mods/tabs-git"
  assert_eq "main" "$(json_get "$HERDR/shared.json" layout)" "shown layout"
  assert_contains "$OUT" "herdr isn't open"
}

run_all() {
  test_case "install links the mod, builds the clones and switches layout" test_install_builds_the_git_panel
  test_case "a switch that does not land is reported" test_a_switch_that_does_not_land_is_reported
  test_case "shipped files are left alone" test_shipped_files_are_left_alone
  test_case "a re-run with the layout active asks nothing of herdr" test_a_rerun_with_the_layout_active_asks_nothing_of_herdr
  test_case "tabs patch failing with no clone stays on main" test_tabs_patch_failing_with_no_clone_stays_on_main
  test_case "changes patch failing with no earlier code stays on main" test_changes_patch_failing_with_no_earlier_code_stays_on_main
  test_case "layout edit failing with no clone stays on main" test_layout_edit_failing_with_no_clone_stays_on_main
  test_case "a failing rebuild keeps the last good mod clone" test_a_failing_rebuild_keeps_the_last_good_mod_clone
  test_case "a rebuild replaces the clone when the patch applies" test_a_rebuild_replaces_the_clone_when_the_patch_applies
  test_case "a failing rebuild keeps the last good Changes code" test_a_failing_rebuild_keeps_the_last_good_changes_code
  test_case "a failing rebuild keeps the last good layout clone" test_a_failing_rebuild_keeps_the_last_good_layout_clone
  test_case "a refused clone puts the last good one back" test_a_refused_clone_puts_the_last_good_one_back
  test_case "dry run changes nothing" test_dry_run_changes_nothing
  test_case "dry run reports a failing patch" test_dry_run_reports_a_failing_patch
  test_case "with herdr closed it links and generates but runs no commands" test_with_herdr_closed_it_links_and_generates_but_runs_no_commands
}

run_all
finish
