#!/usr/bin/env bash
# The patches on herdr's shipped mods, applied as install applies them.

# shellcheck source=tests/helpers.sh
source "$(dirname "${BASH_SOURCE[0]}")/helpers.sh"

PATCHES_ON_HERDR_CHAT=(chat-agents chat-menu chat-menu-clipboard)

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

# herdr-chat's menu-base.js is herdr's shipped menu under a header line.
test_chat_menu_gets_every_patch_once() {
  # Arrange
  new_repo_copy
  local mod="$HERDR/mods/chat-menu" patched_once
  mkdir -p "$mod"
  {
    echo "// Copied by herdr-chat."
    cat "$TESTS_DIR/fixtures/shipped/mods/menu/main.js"
  } >"$mod/menu-base.js"
  install_function patch_herdr_chat_mods
  patched_once="$(cat "$mod/menu-base.js")"

  # Act
  install_function patch_herdr_chat_mods

  # Assert
  assert_contains "$mod/menu-base.js" 'cursor_pointer()'
  assert_contains "$mod/menu-base.js" '["Paste", "terminal.paste", { pane: tg.pane }]'
  assert_eq "$patched_once" "$(cat "$mod/menu-base.js")" "menu after a second run"
  assert_lacks "$OUT" "no longer applies"
  cp "$mod/menu-base.js" "$SANDBOX/built.mjs"
  node --check "$SANDBOX/built.mjs" 2>/dev/null || fail "the patched chat menu is invalid JavaScript"
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
test_case "the chat menu gets every patch once" test_chat_menu_gets_every_patch_once
test_case "every insertion in a patch has context" test_insertions_have_context
finish
