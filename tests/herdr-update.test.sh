#!/usr/bin/env bash
# What update does for herdr once the installed herdr has moved to a new version.
# See tests/helpers.sh for the isolation.

# shellcheck source=tests/helpers.sh
source "$(dirname "${BASH_SOURCE[0]}")/helpers.sh"

OLD_VERSION=0.1.11
NEW_VERSION=0.1.12
RELEASE_MARK="// new in this release"

# A machine with the Git panel built on the old herdr.
installed_on_old_herdr() {
  new_repo_copy
  herdr_with_window
  FAKE_HERDR_VERSION="$OLD_VERSION" install
}

# What herdr writes on its first start of a new release: each shipped file changes.
herdr_ships_a_new_release() {
  printf '%s\n' "$RELEASE_MARK" >>"$HERDR/mods/tabs/main.js"
  printf '%s\n' "$RELEASE_MARK" >>"$HERDR/mods/changes/main.js"
  python3 - "$HERDR/layouts/main.json" <<'PY'
import json, sys
layout = json.load(open(sys.argv[1]))
layout["new_in_release"] = True
json.dump(layout, open(sys.argv[1], "w"))
PY
}

test_update_rebuilds_what_an_older_herdr_built() {
  # Arrange
  installed_on_old_herdr
  herdr_ships_a_new_release

  # Act
  FAKE_HERDR_VERSION="$NEW_VERSION" install --update
  local code=$?

  # Assert
  assert_eq 0 "$code" "exit code"
  assert_eq "$NEW_VERSION" "$(json_get "$HERDR/mods/tabs-git/mod.json" cloned_from.version)" "tabs-git version"
  assert_contains "$HERDR/mods/tabs-git/main.js" "$RELEASE_MARK"
  assert_contains "$HERDR/mods/tabs-git/main.js" 'panelButton("changes", "Git"'
  assert_eq "$NEW_VERSION" "$(json_get "$HERDR/layouts/main-git.json" cloned_from.version)" "main-git version"
  assert_eq "True" "$(json_get "$HERDR/layouts/main-git.json" new_in_release)" "main-git follows the release"
  assert_eq "git" "$(json_get "$HERDR/layouts/main-git.json" '#changes.content.mod')" "changes slot"
  assert_contains "$REPO_COPY/herdr/mods/git/changes.js" "herdr-version: $NEW_VERSION"
  assert_contains "$REPO_COPY/herdr/mods/git/changes.js" "$RELEASE_MARK"
  assert_contains "$REPO_COPY/herdr/mods/git/changes.js" "export class Changes {"
  assert_eq "main-git" "$(json_get "$HERDR/shared.json" layout)" "shown layout"
}

# Marks a build, so a test can tell whether it was replaced even by identical content.
mark_builds() {
  printf '// still the same build\n' >>"$HERDR/mods/tabs-git/main.js"
  printf '// still the same build\n' >>"$REPO_COPY/herdr/mods/git/changes.js"
  python3 - "$HERDR/layouts/main-git.json" <<'PY'
import json, sys
layout = json.load(open(sys.argv[1]))
layout["same_build"] = True
json.dump(layout, open(sys.argv[1], "w"))
PY
}

assert_mod_clone_kept() {
  assert_contains "$HERDR/mods/tabs-git/main.js" "// still the same build"
}

assert_changes_kept() {
  assert_contains "$REPO_COPY/herdr/mods/git/changes.js" "// still the same build"
}

assert_layout_kept() {
  assert_eq "True" "$(json_get "$HERDR/layouts/main-git.json" same_build)" "main-git kept"
}

# Date the git mod's link in the past. herdr reloads a linked mod when the link's
# own time changes, not when a file behind it does.
date_the_mod_link() {
  touch -h -t 200001010000 "$HERDR/mods/git"
  touch -t 200101010000 "$SANDBOX/after-dated-link"
}

mod_link_was_touched() {
  [[ -n "$(find "$HERDR/mods/git" -newer "$SANDBOX/after-dated-link")" ]]
}

test_regenerated_changes_code_reaches_the_open_window() {
  # Arrange
  installed_on_old_herdr
  herdr_ships_a_new_release
  date_the_mod_link

  # Act
  FAKE_HERDR_VERSION="$NEW_VERSION" install --update

  # Assert
  mod_link_was_touched || fail "the git mod's link was not touched, so the window keeps the old code"
}

test_current_changes_code_does_not_reload_the_mod() {
  # Arrange
  new_repo_copy
  herdr_with_window
  FAKE_HERDR_VERSION="$NEW_VERSION" install
  date_the_mod_link

  # Act
  FAKE_HERDR_VERSION="$NEW_VERSION" install --update

  # Assert
  ! mod_link_was_touched || fail "the git mod's link was touched with nothing regenerated"
}

test_a_rebuilt_layout_keeps_the_clicks_made_on_it() {
  # Arrange: a size the user set on main-git, and a different one on main
  installed_on_old_herdr
  herdr_ships_a_new_release
  mkdir -p "$HERDR/layouts/.state"
  printf '{"nodes":{"sidebar":{"size":{"px":400}}}}' >"$HERDR/layouts/.state/main-git.json"
  printf '{"nodes":{"sidebar":{"size":{"px":200}}}}' >"$HERDR/layouts/.state/main.json"

  # Act: the next click writes back whatever the window holds in memory
  FAKE_HERDR_VERSION="$NEW_VERSION" install --update
  # shellcheck disable=SC1010  # `herdr-app do` is its subcommand, not the keyword
  in_sandbox HERDR_APP_HOME="$HERDR" herdr-app do layout.resize '{"id":"panel","px":333}'

  # Assert
  assert_eq "$NEW_VERSION" "$(json_get "$HERDR/layouts/main-git.json" cloned_from.version)" "main-git version"
  assert_eq "main-git" "$(json_get "$HERDR/shared.json" layout)" "shown layout"
  assert_eq "400" "$(json_get "$HERDR/layouts/.state/main-git.json" nodes.sidebar.size.px)" "earlier click"
  assert_eq "333" "$(json_get "$HERDR/layouts/.state/main-git.json" nodes.panel.size.px)" "later click"
}

test_put_back_clicks_keep_their_file_permissions() {
  # Arrange
  installed_on_old_herdr
  herdr_ships_a_new_release
  mkdir -p "$HERDR/layouts/.state"
  printf '{"nodes":{}}' >"$HERDR/layouts/.state/main-git.json"
  chmod 644 "$HERDR/layouts/.state/main-git.json"

  # Act
  FAKE_HERDR_VERSION="$NEW_VERSION" install --update

  # Assert
  # shellcheck disable=SC2012  # the mode string is what's being compared
  assert_eq "-rw-r--r--" "$(ls -l "$HERDR/layouts/.state/main-git.json" | cut -c1-10)" "permissions"
}

test_a_rebuilt_layout_with_no_clicks_does_not_reshow_it() {
  # Arrange
  installed_on_old_herdr
  herdr_ships_a_new_release
  rm "$HERDR/fake-calls.log"

  # Act
  FAKE_HERDR_VERSION="$NEW_VERSION" install --update

  # Assert
  assert_lacks "$HERDR/fake-calls.log" "layout.switch"
  assert_eq "main-git" "$(json_get "$HERDR/shared.json" layout)" "shown layout"
}

test_update_leaves_alone_what_the_running_herdr_built() {
  # Arrange
  new_repo_copy
  herdr_with_window
  FAKE_HERDR_VERSION="$NEW_VERSION" install
  mark_builds
  rm "$HERDR/fake-calls.log"

  # Act
  FAKE_HERDR_VERSION="$NEW_VERSION" install --update
  local code=$?

  # Assert
  assert_eq 0 "$code" "exit code"
  assert_mod_clone_kept
  assert_changes_kept
  assert_layout_kept
  assert_no_file "$HERDR/fake-calls.log"
  assert_lacks "$OUT" "came from herdr"
}

test_update_rebuilds_only_the_clone_from_another_version() {
  # Arrange: only tabs-git is behind
  new_repo_copy
  herdr_with_window
  FAKE_HERDR_VERSION="$NEW_VERSION" install
  mark_builds
  python3 - "$HERDR/mods/tabs-git/mod.json" "$OLD_VERSION" <<'PY'
import json, sys
meta = json.load(open(sys.argv[1]))
meta["cloned_from"]["version"] = sys.argv[2]
json.dump(meta, open(sys.argv[1], "w"))
PY

  # Act
  FAKE_HERDR_VERSION="$NEW_VERSION" install --update

  # Assert
  assert_eq "$NEW_VERSION" "$(json_get "$HERDR/mods/tabs-git/mod.json" cloned_from.version)" "tabs-git version"
  assert_changes_kept
  assert_layout_kept
}

test_a_clone_with_no_recorded_version_is_rebuilt() {
  # Arrange
  new_repo_copy
  herdr_with_window
  FAKE_HERDR_VERSION="$NEW_VERSION" install
  printf '{ "place": "none", "title": "Tabs" }' >"$HERDR/mods/tabs-git/mod.json"

  # Act
  FAKE_HERDR_VERSION="$NEW_VERSION" install --update
  local code=$?

  # Assert
  assert_eq 0 "$code" "exit code"
  assert_eq "$NEW_VERSION" "$(json_get "$HERDR/mods/tabs-git/mod.json" cloned_from.version)" "tabs-git version"
}

test_install_without_update_keeps_what_an_older_herdr_built() {
  # Arrange
  installed_on_old_herdr
  herdr_ships_a_new_release
  mark_builds

  # Act
  FAKE_HERDR_VERSION="$NEW_VERSION" install
  local code=$?

  # Assert
  assert_eq 0 "$code" "exit code"
  assert_eq "$OLD_VERSION" "$(json_get "$HERDR/mods/tabs-git/mod.json" cloned_from.version)" "tabs-git version"
  assert_mod_clone_kept
  assert_changes_kept
  assert_layout_kept
}

test_a_tabs_patch_that_no_longer_applies_keeps_that_clone_only() {
  # Arrange
  installed_on_old_herdr
  herdr_ships_a_new_release
  mark_builds
  printf '// upstream rewrote the tab bar\n' >"$HERDR/mods/tabs/main.js"

  # Act
  FAKE_HERDR_VERSION="$NEW_VERSION" install --update
  local code=$?

  # Assert
  assert_eq 0 "$code" "exit code"
  assert_contains "$OUT" "herdr/patches/tabs.patch no longer applies to herdr $NEW_VERSION"
  assert_contains "$OUT" "keeping the last good tabs-git"
  assert_mod_clone_kept
  assert_eq "$OLD_VERSION" "$(json_get "$HERDR/mods/tabs-git/mod.json" cloned_from.version)" "tabs-git version"
  assert_eq "$NEW_VERSION" "$(json_get "$HERDR/layouts/main-git.json" cloned_from.version)" "main-git version"
  assert_contains "$REPO_COPY/herdr/mods/git/changes.js" "herdr-version: $NEW_VERSION"
  assert_eq "main-git" "$(json_get "$HERDR/shared.json" layout)" "shown layout"
}

test_a_changes_patch_that_no_longer_applies_keeps_that_code_only() {
  # Arrange
  installed_on_old_herdr
  herdr_ships_a_new_release
  mark_builds
  printf '// upstream rewrote the panel\n' >"$HERDR/mods/changes/main.js"

  # Act
  FAKE_HERDR_VERSION="$NEW_VERSION" install --update
  local code=$?

  # Assert
  assert_eq 0 "$code" "exit code"
  assert_contains "$OUT" "herdr/patches/changes.patch no longer applies to herdr $NEW_VERSION"
  assert_contains "$OUT" "keeping the last good Changes code"
  assert_changes_kept
  assert_contains "$REPO_COPY/herdr/mods/git/changes.js" "herdr-version: $OLD_VERSION"
  assert_eq "$NEW_VERSION" "$(json_get "$HERDR/mods/tabs-git/mod.json" cloned_from.version)" "tabs-git version"
  assert_eq "$NEW_VERSION" "$(json_get "$HERDR/layouts/main-git.json" cloned_from.version)" "main-git version"
  assert_eq "main-git" "$(json_get "$HERDR/shared.json" layout)" "shown layout"
}

test_a_layout_edit_that_no_longer_applies_keeps_that_clone_only() {
  # Arrange
  installed_on_old_herdr
  herdr_ships_a_new_release
  mark_builds
  printf '{"id":"root","type":"row","children":[{"id":"tabs","type":"block","content":{"mod":"tabs"}}]}' >"$HERDR/layouts/main.json"

  # Act
  FAKE_HERDR_VERSION="$NEW_VERSION" install --update
  local code=$?

  # Assert
  assert_eq 0 "$code" "exit code"
  assert_contains "$OUT" "herdr/patches/main-layout.json no longer applies to herdr $NEW_VERSION"
  assert_contains "$OUT" "keeping the last good main-git"
  assert_layout_kept
  assert_eq "$NEW_VERSION" "$(json_get "$HERDR/mods/tabs-git/mod.json" cloned_from.version)" "tabs-git version"
  assert_eq "main-git" "$(json_get "$HERDR/shared.json" layout)" "shown layout"
}

test_a_failed_rebuild_still_lands_on_the_git_layout() {
  # Arrange: the machine is on main, and tabs-git can't be rebuilt
  installed_on_old_herdr
  herdr_ships_a_new_release
  printf '// upstream rewrote the tab bar\n' >"$HERDR/mods/tabs/main.js"
  printf '{"layout":"main"}' >"$HERDR/shared.json"

  # Act
  FAKE_HERDR_VERSION="$NEW_VERSION" install --update

  # Assert: the last good clone is good enough to show
  assert_eq "main-git" "$(json_get "$HERDR/shared.json" layout)" "shown layout"
}

test_a_failed_layout_rebuild_still_lands_on_the_last_good_one() {
  # Arrange: the machine is on main, and main-git can't be rebuilt
  installed_on_old_herdr
  herdr_ships_a_new_release
  printf '{"id":"root","type":"row","children":[{"id":"tabs","type":"block","content":{"mod":"tabs"}}]}' >"$HERDR/layouts/main.json"
  printf '{"layout":"main"}' >"$HERDR/shared.json"

  # Act
  FAKE_HERDR_VERSION="$NEW_VERSION" install --update

  # Assert
  assert_eq "main-git" "$(json_get "$HERDR/shared.json" layout)" "shown layout"
  assert_eq "$OLD_VERSION" "$(json_get "$HERDR/layouts/main-git.json" cloned_from.version)" "main-git version"
}

test_dry_run_reports_what_would_be_rebuilt_and_changes_nothing() {
  # Arrange
  installed_on_old_herdr
  herdr_ships_a_new_release
  rm "$HERDR/fake-calls.log"
  local home_before changes_before
  home_before="$(tree_state)"
  changes_before="$(cksum <"$REPO_COPY/herdr/mods/git/changes.js")"

  # Act
  FAKE_HERDR_VERSION="$NEW_VERSION" install --update --dry-run
  local code=$?

  # Assert
  assert_eq 0 "$code" "exit code"
  assert_eq "$home_before" "$(tree_state)" "home"
  assert_eq "$changes_before" "$(cksum <"$REPO_COPY/herdr/mods/git/changes.js")" "changes.js"
  assert_no_file "$HERDR/fake-calls.log"
  assert_contains "$OUT" "tabs-git came from herdr $OLD_VERSION, running $NEW_VERSION"
  assert_contains "$OUT" "main-git came from herdr $OLD_VERSION, running $NEW_VERSION"
  assert_contains "$OUT" "Changes code came from herdr $OLD_VERSION, running $NEW_VERSION"
  assert_contains "$OUT" '[dry-run] herdr-app do mod.clone {"name":"tabs","as":"tabs-git"}'
  assert_contains "$OUT" '[dry-run] herdr-app do layout.clone {"name":"main","as":"main-git"}'
  assert_contains "$OUT" "would generate $REPO_COPY/herdr/mods/git/changes.js from herdr $NEW_VERSION"
}

test_dry_run_reports_nothing_to_rebuild_when_all_is_current() {
  # Arrange
  new_repo_copy
  herdr_with_window
  FAKE_HERDR_VERSION="$NEW_VERSION" install

  # Act
  FAKE_HERDR_VERSION="$NEW_VERSION" install --update --dry-run

  # Assert
  assert_lacks "$OUT" "came from herdr"
  assert_lacks "$OUT" "mod.clone"
  assert_contains "$OUT" "main-git is active"
}

test_with_the_window_closed_update_starts_it_and_builds_from_what_it_ships() {
  # Arrange: the new binary is in place, but shipped files only change on its first start
  installed_on_old_herdr
  rm "$HERDR/fake-window"
  printf '// shipped by the old release\n' >>"$HERDR/mods/changes/main.js"
  printf '// shipped by the old release\n' >>"$HERDR/mods/tabs/main.js"

  # Act
  FAKE_HERDR_VERSION="$NEW_VERSION" install --update
  local code=$?

  # Assert
  assert_eq 0 "$code" "exit code"
  assert_file "$HERDR/fake-launches.log"
  assert_contains "$REPO_COPY/herdr/mods/git/changes.js" "herdr-version: $NEW_VERSION"
  assert_lacks "$REPO_COPY/herdr/mods/git/changes.js" "shipped by the old release"
  assert_eq "$NEW_VERSION" "$(json_get "$HERDR/mods/tabs-git/mod.json" cloned_from.version)" "tabs-git version"
  assert_lacks "$HERDR/mods/tabs-git/main.js" "shipped by the old release"
  assert_eq "$NEW_VERSION" "$(json_get "$HERDR/layouts/main-git.json" cloned_from.version)" "main-git version"
  assert_eq "main-git" "$(json_get "$HERDR/shared.json" layout)" "shown layout"
}

test_a_window_that_never_opens_leaves_everything_as_it_was() {
  # Arrange
  installed_on_old_herdr
  mark_builds
  rm "$HERDR/fake-window"
  touch "$HERDR/fake-window-never-opens"

  # Act
  FAKE_HERDR_VERSION="$NEW_VERSION" install --update
  local code=$?

  # Assert
  assert_eq 0 "$code" "exit code"
  assert_changes_kept
  assert_mod_clone_kept
  assert_layout_kept
  assert_contains "$REPO_COPY/herdr/mods/git/changes.js" "herdr-version: $OLD_VERSION"
  assert_contains "$OUT" "open it and re-run install"
  assert_lacks "$OUT" "main-git is active"
}

test_with_the_window_closed_and_all_current_no_window_opens() {
  # Arrange
  new_repo_copy
  herdr_with_window
  FAKE_HERDR_VERSION="$NEW_VERSION" install
  rm "$HERDR/fake-window"

  # Act
  FAKE_HERDR_VERSION="$NEW_VERSION" install --update
  local code=$?

  # Assert
  assert_eq 0 "$code" "exit code"
  assert_no_file "$HERDR/fake-launches.log"
  assert_contains "$OUT" "main-git is active"
}

run_all() {
  test_case "update rebuilds what an older herdr built" test_update_rebuilds_what_an_older_herdr_built
  test_case "regenerated Changes code reaches the open window" test_regenerated_changes_code_reaches_the_open_window
  test_case "current Changes code does not reload the mod" test_current_changes_code_does_not_reload_the_mod
  test_case "a rebuilt layout keeps the clicks made on it" test_a_rebuilt_layout_keeps_the_clicks_made_on_it
  test_case "put back clicks keep their file permissions" test_put_back_clicks_keep_their_file_permissions
  test_case "a rebuilt layout with no clicks does not reshow it" test_a_rebuilt_layout_with_no_clicks_does_not_reshow_it
  test_case "update leaves alone what the running herdr built" test_update_leaves_alone_what_the_running_herdr_built
  test_case "update rebuilds only the clone from another version" test_update_rebuilds_only_the_clone_from_another_version
  test_case "a clone with no recorded version is rebuilt" test_a_clone_with_no_recorded_version_is_rebuilt
  test_case "install without update keeps what an older herdr built" test_install_without_update_keeps_what_an_older_herdr_built
  test_case "a tabs patch that no longer applies keeps that clone only" test_a_tabs_patch_that_no_longer_applies_keeps_that_clone_only
  test_case "a changes patch that no longer applies keeps that code only" test_a_changes_patch_that_no_longer_applies_keeps_that_code_only
  test_case "a layout edit that no longer applies keeps that clone only" test_a_layout_edit_that_no_longer_applies_keeps_that_clone_only
  test_case "a failed rebuild still lands on the git layout" test_a_failed_rebuild_still_lands_on_the_git_layout
  test_case "a failed layout rebuild still lands on the last good one" test_a_failed_layout_rebuild_still_lands_on_the_last_good_one
  test_case "dry run reports what would be rebuilt and changes nothing" test_dry_run_reports_what_would_be_rebuilt_and_changes_nothing
  test_case "dry run reports nothing to rebuild when all is current" test_dry_run_reports_nothing_to_rebuild_when_all_is_current
  test_case "with the window closed update starts it and builds from what it ships" test_with_the_window_closed_update_starts_it_and_builds_from_what_it_ships
  test_case "a window that never opens leaves everything as it was" test_a_window_that_never_opens_leaves_everything_as_it_was
  test_case "with the window closed and all current no window opens" test_with_the_window_closed_and_all_current_no_window_opens
}

run_all
finish
