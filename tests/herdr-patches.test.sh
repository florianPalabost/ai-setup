#!/usr/bin/env bash
# The patches on herdr's shipped mods, applied as install applies them.

# shellcheck source=tests/helpers.sh
source "$(dirname "${BASH_SOURCE[0]}")/helpers.sh"

PATCHES_ON_HERDR_CHAT=(chat-agents chat-menu)

patches_herdr_chat() {
  local name
  for name in "${PATCHES_ON_HERDR_CHAT[@]}"; do
    [[ "$name" == "$1" ]] && return 0
  done
  return 1
}

test_patched_mods_are_valid_javascript() {
  # Arrange
  new_repo_copy
  local patch name built="$SANDBOX/built.mjs"

  for patch in "$REPO_COPY"/herdr/patches/*.patch; do
    name="$(basename "$patch" .patch)"
    patches_herdr_chat "$name" && continue
    rm -f "$built"

    # Act
    install_function patched_copy "$TESTS_DIR/fixtures/shipped/mods/$name/main.js" "$patch" "$built"

    # Assert
    if [[ ! -f "$built" ]]; then
      fail "$name.patch does not apply to its fixture"
    elif ! node --check "$built" >"$SANDBOX/syntax" 2>&1; then
      fail "$name.patch builds invalid JavaScript: $(grep -m1 SyntaxError "$SANDBOX/syntax")"
    fi
  done
}

test_insertions_have_context() {
  # Arrange
  local bare_insertion='^@@ -[0-9]+,0 ' patch

  for patch in "$REPO"/herdr/patches/*.patch; do
    # Act / Assert
    if grep -qE "$bare_insertion" "$patch"; then
      fail "$(basename "$patch") has an insertion without context, which patch places by line number"
    fi
  done
}

test_case "patched mods are valid JavaScript" test_patched_mods_are_valid_javascript
test_case "every insertion in a patch has context" test_insertions_have_context
finish
