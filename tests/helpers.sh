# shellcheck shell=bash
# Shared by the tests/*.test.sh scripts. Source it, don't run it.
#
# Every install runs under `env -i` with a throwaway HOME, so nothing inherited
# can lead it to the real one: not HOME, CLAUDE_CONFIG_DIR, XDG_DATA_HOME or
# HERDR_APP_HOME. herdr-app, claude and npx are the fakes in tests/fakes, and the
# real ones aren't on PATH.

TESTS_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="$(dirname "$TESTS_DIR")"
REAL_GIT="$(command -v git)"
SYSTEM_PATH="/usr/bin:/bin"
FAILED=0
RAN=0

new_sandbox() {
  SANDBOX="$(mktemp -d)"
  SANDBOX_HOME="$SANDBOX/home"
  HERDR="$SANDBOX_HOME/.config/herdr-app"
  mkdir -p "$SANDBOX_HOME" "$SANDBOX/bin"
  cp "$TESTS_DIR/fakes/herdr-app" "$TESTS_DIR/fakes/claude" "$TESTS_DIR/fakes/npx" "$TESTS_DIR/fakes/git" "$SANDBOX/bin/"
}

# A copy of the repo's scripts and herdr files, for a run that writes into the
# repo: generated code must not land in the checkout under test.
new_repo_copy() {
  REPO_COPY="$SANDBOX/repo"
  mkdir -p "$REPO_COPY"
  cp -R "$REPO/install.sh" "$REPO/snapshot.sh" "$REPO/lib.sh" "$REPO/herdr.sh" "$REPO/herdr" \
    "$REPO/global" "$REPO/plugins" "$REPO/manifests" "$REPO/.gitignore" "$REPO_COPY/"
  rm -f "$REPO_COPY/herdr/mods/git/changes.js"
  "$REAL_GIT" -C "$REPO_COPY" init --quiet
}

# What herdr ships, as found once it has started, with its window open.
herdr_with_window() {
  mkdir -p "$HERDR"
  cp -R "$TESTS_DIR/fixtures/shipped/mods" "$TESTS_DIR/fixtures/shipped/layouts" "$HERDR/"
  printf '{"layout":"main"}' >"$HERDR/shared.json"
  touch "$HERDR/fake-window"
}

in_sandbox() {
  env -i HOME="$SANDBOX_HOME" PATH="$SANDBOX/bin:$SYSTEM_PATH" REAL_GIT="$REAL_GIT" \
    FAKE_HERDR_VERSION="${FAKE_HERDR_VERSION:-0.1.12}" "$@"
}

# Runs the install in the repo copy, leaving its output in $OUT.
install() {
  OUT="$SANDBOX/out"
  in_sandbox bash "$REPO_COPY/install.sh" "$@" </dev/null >"$OUT" 2>&1
}

# Runs one function of the install in the repo copy, leaving its output in $OUT.
install_function() {
  OUT="$SANDBOX/out"
  # install.sh parses the positional parameters, so it gets none.
  # shellcheck disable=SC2016
  in_sandbox bash -c 'repo="$1"; shift; step=("$@"); set --; source "$repo/install.sh"; "${step[@]}"' \
    _ "$REPO_COPY" "$@" </dev/null >"$OUT" 2>&1
}

# Every path under the sandbox's home with its link target or content hash.
tree_state() {
  (cd "$SANDBOX_HOME" && find . | LC_ALL=C sort | while IFS= read -r path; do
    if [[ -L "$path" ]]; then
      printf '%s -> %s\n' "$path" "$(readlink "$path")"
    elif [[ -f "$path" ]]; then
      printf '%s %s\n' "$path" "$(cksum <"$path")"
    else
      printf '%s\n' "$path"
    fi
  done)
}

json_get() {
  python3 - "$1" "$2" <<'PY'
import json, sys

def find(node, node_id):
    if node.get("id") == node_id:
        return node
    for child in node.get("children", []):
        found = find(child, node_id)
        if found:
            return found

root = json.load(open(sys.argv[1]))
path = sys.argv[2].split(".")
value = find(root, path[0][1:]) if path[0].startswith("#") else root.get(path[0])
for key in path[1:]:
    value = value.get(key) if value else None
print(value)
PY
}

fail() {
  printf '    %s\n' "$*" >&2
  CURRENT_FAILED=1
}

assert_eq() {
  [[ "$2" == "$1" ]] || fail "${3:-value}: expected '$1', got '$2'"
}

assert_file() {
  [[ -e "$1" ]] || fail "expected $1 to exist"
}

assert_no_file() {
  [[ ! -e "$1" && ! -L "$1" ]] || fail "expected $1 not to exist"
}

assert_contains() {
  grep -qF -- "$2" "$1" || fail "expected $1 to contain: $2"
}

assert_lacks() {
  ! grep -qF -- "$2" "$1" 2>/dev/null || fail "expected $1 not to contain: $2"
}

# test <name> <function>: runs the function in its own sandbox and shell.
test_case() {
  local name="$1" fn="$2" CURRENT_FAILED=0
  RAN=$((RAN + 1))
  new_sandbox
  # The function's failures are reported through CURRENT_FAILED, so it runs in
  # this shell. `set -e` stays off: an install exiting non-zero is checked by the test.
  "$fn"
  rm -rf "$SANDBOX"
  if ((CURRENT_FAILED)); then
    FAILED=$((FAILED + 1))
    printf 'not ok - %s\n' "$name"
  else
    printf 'ok - %s\n' "$name"
  fi
}

finish() {
  printf '%d run, %d failed\n' "$RAN" "$FAILED"
  ((FAILED == 0))
}
