#!/usr/bin/env bash
# Which herdr files the repo tracks, and that snapshot leaves them alone.

# shellcheck source=tests/helpers.sh
source "$(dirname "${BASH_SOURCE[0]}")/helpers.sh"

test_machine_local_and_generated_files_stay_untracked() {
  # Arrange
  new_repo_copy
  local ignored=(
    herdr/keys.json herdr/settings.json herdr/shared.json herdr/view.json herdr/installed.json
    herdr/mods/git/changes.js herdr/mods/git/gpui-kit.d.ts herdr/mods/git/jsconfig.json herdr/mods/git/main.error
  )

  for path in "${ignored[@]}"; do
    # Act / Assert
    "$REAL_GIT" -C "$REPO_COPY" check-ignore -q "$path" || fail "$path should be ignored"
  done
}

test_own_mods_and_patches_are_tracked() {
  # Arrange
  new_repo_copy
  local tracked=(herdr/mods/git/main.js herdr/mods/git/mod.json herdr/patches/tabs.patch herdr/patches/changes.patch herdr/patches/main-layout.json)

  for path in "${tracked[@]}"; do
    # Act / Assert
    if "$REAL_GIT" -C "$REPO_COPY" check-ignore -q "$path"; then
      fail "$path should be tracked"
    fi
  done
}

test_snapshot_leaves_the_herdr_files_alone() {
  # Arrange
  new_repo_copy
  printf '// generated\n' >"$REPO_COPY/herdr/mods/git/changes.js"
  mkdir -p "$SANDBOX_HOME/.claude/plugins" "$SANDBOX_HOME/.claude/skills" "$SANDBOX_HOME/.config/herdr-app/mods"
  printf '{}' >"$SANDBOX_HOME/.claude/plugins/known_marketplaces.json"
  ln -s "$REPO_COPY/herdr/mods/git" "$SANDBOX_HOME/.config/herdr-app/mods/git"
  local before
  before="$(cd "$REPO_COPY" && find herdr -type f -exec cksum {} + | LC_ALL=C sort)"

  # Act
  in_sandbox bash "$REPO_COPY/snapshot.sh" >"$SANDBOX/out" 2>&1
  local code=$?

  # Assert
  assert_eq 0 "$code" "exit code"
  assert_eq "$before" "$(cd "$REPO_COPY" && find herdr -type f -exec cksum {} + | LC_ALL=C sort)" "herdr files"
  assert_lacks "$REPO_COPY/manifests/plugins.txt" "herdr"
  assert_lacks "$REPO_COPY/manifests/skills.txt" "herdr"
}

test_case "machine-local and generated herdr files stay untracked" test_machine_local_and_generated_files_stay_untracked
test_case "own mods and patches are tracked" test_own_mods_and_patches_are_tracked
test_case "snapshot leaves the herdr files alone" test_snapshot_leaves_the_herdr_files_alone
finish
