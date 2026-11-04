# shellcheck shell=bash disable=SC1010  # `herdr-app do` is its subcommand, not the keyword
# The herdr step of install.sh: the Git panel. Sourced by install.sh, whose run,
# link and backup it uses.
#
# Own mods are linked from herdr/mods/. What differs from herdr's shipped files
# is kept as patches in herdr/patches/ and built into real files here, from
# whatever the installed herdr ships (docs/adr/0002). A build checks its patch
# against the shipped file first, so a patch that no longer applies changes nothing.
# Install builds what's missing. Update also rebuilds what another herdr version built.

HERDR_HOME="${HERDR_APP_HOME:-$HOME/.config/herdr-app}"
# herdr-app must ask the window of the home this script writes to.
export HERDR_APP_HOME="$HERDR_HOME"

HERDR_SRC="$REPO_DIR/herdr"
# Linked as $HERDR_HOME/mods/<name>.
HERDR_OWN_MODS=(git git-graph)
# Icons of linked mods, copied as real files: herdr refuses an svg path that a link
# leads out of its home. "<folder in herdr/mods/> <folder in the herdr home>"
HERDR_MOD_ICONS=("git-graph/icons git-graph-icons")
# "<shipped mod> <clone> <patch in herdr/patches/>"
HERDR_MOD_CLONES=("tabs tabs-git tabs.patch")
HERDR_LAYOUT_SHIPPED=main
HERDR_LAYOUT=main-git
HERDR_LAYOUT_EDIT="$HERDR_SRC/patches/main-layout.json"
HERDR_CHANGES_PATCH="$HERDR_SRC/patches/changes.patch"
HERDR_CHANGES_JS="$HERDR_SRC/mods/git/changes.js"
HERDR_CHANGES_LINK="$HERDR_HOME/mods/git"
HERDR_VERSION_MARK="herdr-version:"
HERDR_INSTALLER_SH="https://releases.herdr.dev/app/install.sh"
HERDR_INSTALLER_PS1="https://releases.herdr.dev/app/install.ps1"
# First answers took under a second, so these are only reached when something's wrong.
HERDR_WINDOW_WAIT_SECS="${HERDR_WINDOW_WAIT_SECS:-60}"
HERDR_STATUS_CALL_SECS="${HERDR_STATUS_CALL_SECS:-10}"
# Same code as timeout(1).
HERDR_STATUS_STUCK=124
# Set once the herdr step goes ahead on this machine.
HERDR_PANEL_WANTED=0
# What the leftover check offers to remove. These can't be read from the repo's
# history: the prototypes were only ever on prototype/* branches. When a mod or
# clone leaves the lists above, add it here.
HERDR_DROPPED_MODS=(proto-git proto-graph-community proto-pr-pane proto-prs-panel tabs-proto)
HERDR_DROPPED_LAYOUTS=(main-proto)

# The version of the binary on disk, which an update can replace under an open window.
herdr_version() {
  herdr-app --version | awk '{print $NF}'
}

# The version the shipped files came from. herdr rewrites them on each start and
# records that start's version, so this holds while an older window stays open
# over a newer binary, and with no window at all.
herdr_shipped_version() {
  local version
  version="$(py3 - "$HERDR_HOME/update-notes.json" <<'PY'
import json, sys

try:
    print(json.load(open(sys.argv[1]))["last_run"])
except (OSError, ValueError, KeyError, TypeError):
    print("")
PY
)"
  printf '%s\n' "${version:-$(herdr_version)}"
}

# The version a build should come from: the open window's, as its shipped files
# are what a build reads and mod.clone records it. With none open, the binary's,
# which is what the next window will be and write.
herdr_running_version() {
  if herdr_status; then
    herdr_shipped_version
  else
    herdr_version
  fi
}

# Whether this is Linux or WSL (uname says Linux for both) with nowhere to show a window.
herdr_has_no_display() {
  [[ "$(uname -s)" == Linux && -z "${DISPLAY:-}" && -z "${WAYLAND_DISPLAY:-}" ]]
}

# The layout herdr is showing, "main" if it hasn't recorded one.
herdr_shown_layout() {
  py3 - "$HERDR_HOME/shared.json" <<'PY'
import json, sys
from pathlib import Path

shared = Path(sys.argv[1])
try:
    print(json.loads(shared.read_text()).get("layout") or "main")
except (OSError, ValueError):
    print("main")
PY
}

# The layout the open window reports showing. Unlike shared.json, it can't lag.
herdr_window_layout() {
  herdr-app status | py3 -c 'import json, sys; print(json.load(sys.stdin).get("layout"))'
}

# Write to $3 the file $1 with the patch $2 applied. If it doesn't apply, return
# 1 and leave $3 alone. $1 and $3 can be the same file.
patched_copy() {
  local src="$1" patch="$2" dst="$3" dir status=0
  dir="$(mktemp -d)"
  cp "$src" "$dir/main.js"
  # No fuzz: a patch fails exactly where an upstream change touches our edits.
  if patch -s -f -F0 -p1 -d "$dir" -i "$patch" >/dev/null 2>&1; then
    cp "$dir/main.js" "$dst"
  else
    status=1
  fi
  rm -rf "$dir"
  return "$status"
}

# Whether the patch $2 applies to the file $1. Writes nothing.
patch_applies() {
  local out status=0
  out="$(mktemp)"
  patched_copy "$1" "$2" "$out" || status=1
  rm -f "$out"
  return "$status"
}

# Write to $3 the layout $1 with the edit $2 applied: for each block id, the mod
# it holds. If the edit doesn't apply, return 1 and leave $3 alone. The layout is
# edited as JSON because herdr may reorder its keys, which a text patch can't follow.
edited_layout() {
  py3 - "$@" <<'PY'
import json, sys
from pathlib import Path

EXIT_EDIT_DOES_NOT_APPLY = 1

src, edit, dst = map(Path, sys.argv[1:4])
layout = json.loads(src.read_text())
blocks = json.loads(edit.read_text())["blocks"]

def visit(node):
    change = blocks.get(node.get("id"))
    if change:
        content = node.get("content", {})
        if content.get("mod") != change["from"]:
            sys.exit(EXIT_EDIT_DOES_NOT_APPLY)
        content["mod"] = change["to"]
        seen.add(node["id"])
    for child in node.get("children", []):
        visit(child)

seen = set()
visit(layout)
if seen != set(blocks):
    sys.exit(EXIT_EDIT_DOES_NOT_APPLY)
dst.write_text(json.dumps(layout, indent=2) + "\n")
PY
}

# Whether the edit $2 applies to the layout $1. Writes nothing.
layout_edit_applies() {
  local out status=0
  out="$(mktemp)"
  edited_layout "$1" "$2" "$out" 2>/dev/null || status=1
  rm -f "$out"
  return "$status"
}

# Warn that the patch $1 can't build $2, whose last good build is at $3.
warn_build_failed() {
  local patch="$1" what="$2" last_good="$3"
  warn "${patch#"$REPO_DIR"/} no longer applies to herdr $(herdr_shipped_version): $what not built"
  if [[ -e "$last_good" ]]; then
    warn "keeping the last good $what"
  else
    warn "no earlier $what: staying on the current layout, with the mods installed but unused"
  fi
}

link_herdr_mods() {
  local name
  for name in "${HERDR_OWN_MODS[@]}"; do
    link "$HERDR_SRC/mods/$name" "$HERDR_HOME/mods/$name"
  done
}

copy_herdr_mod_icons() {
  local spec src dst
  for spec in "${HERDR_MOD_ICONS[@]}"; do
    read -r src dst <<<"$spec"
    if diff -r "$HERDR_SRC/mods/$src" "$HERDR_HOME/$dst" >/dev/null 2>&1; then
      continue
    fi
    run rm -rf "${HERDR_HOME:?}/$dst"
    run mkdir -p "$HERDR_HOME"
    run cp -R "$HERDR_SRC/mods/$src" "$HERDR_HOME/$dst"
    info "copied $HERDR_HOME/$dst"
  done
}

# Generate the Changes code in herdr/mods/git/ from the shipped changes mod. Its
# second line records the herdr version it came from.
build_changes() {
  local shipped="$HERDR_HOME/mods/changes/main.js" patched version
  if [[ ! -f "$shipped" ]]; then
    warn "$shipped not found: start herdr once, then re-run install"
    return 1
  fi
  patched="$(mktemp)"
  if ! patched_copy "$shipped" "$HERDR_CHANGES_PATCH" "$patched"; then
    rm -f "$patched"
    warn_build_failed "$HERDR_CHANGES_PATCH" "Changes code" "$HERDR_CHANGES_JS"
    return 1
  fi
  version="$(herdr_shipped_version)"
  if ((DRY_RUN)); then
    info "[dry-run] would generate $HERDR_CHANGES_JS from herdr $version"
  else
    {
      printf '// Generated by install.sh from herdr'\''s changes mod and herdr/patches/changes.patch. Do not edit.\n'
      printf '// %s %s\n' "$HERDR_VERSION_MARK" "$version"
      cat "$patched"
    } >"$HERDR_CHANGES_JS.tmp"
    mv "$HERDR_CHANGES_JS.tmp" "$HERDR_CHANGES_JS"
    # An open window reloads a linked mod when the link changes, not when a file
    # behind it does. Before the first link there is nothing to reload.
    if [[ -L "$HERDR_CHANGES_LINK" ]]; then
      touch -h "$HERDR_CHANGES_LINK"
    fi
    info "generated $HERDR_CHANGES_JS from herdr $version"
  fi
  rm -f "$patched"
}

# Put a clone set aside by backup back at $1, discarding whatever is there.
restore_backup() {
  rm -rf "$1"
  if [[ -e "$BACKUP_DIR/${1#"$HOME"/}" ]]; then
    mv "$BACKUP_DIR/${1#"$HOME"/}" "$1"
  fi
}

# Build the clone $2 of the shipped mod $1, patched with herdr/patches/$3. If
# anything fails, a clone already there stays as it was.
build_mod_clone() {
  local shipped="$1" clone="$2" patch="$HERDR_SRC/patches/$3"
  local source_js="$HERDR_HOME/mods/$shipped/main.js" dir="$HERDR_HOME/mods/$clone"
  if [[ ! -f "$source_js" ]]; then
    warn "$source_js not found: start herdr once, then re-run install"
    return 1
  fi
  if ! patch_applies "$source_js" "$patch"; then
    warn_build_failed "$patch" "$clone" "$dir"
    return 1
  fi
  backup "$dir"
  if ((DRY_RUN)); then
    run herdr-app do mod.clone "{\"name\":\"$shipped\",\"as\":\"$clone\"}"
    info "[dry-run] would apply ${patch#"$REPO_DIR"/} to $dir/main.js"
    return 0
  fi
  if ! herdr-app do mod.clone "{\"name\":\"$shipped\",\"as\":\"$clone\"}" >/dev/null; then
    restore_backup "$dir"
    warn "herdr could not clone $shipped as $clone"
    return 1
  fi
  if ! patched_copy "$dir/main.js" "$patch" "$dir/main.js"; then
    restore_backup "$dir"
    warn_build_failed "$patch" "$clone" "$dir"
    return 1
  fi
  info "built $clone from $shipped"
}

# Show the layout $1, reading its clicks from disk. The window only reads them
# when it switches to a layout, and until then the next click overwrites the file
# with what it holds in memory.
show_layout_afresh() {
  herdr-app do layout.switch "{\"name\":\"$HERDR_LAYOUT_SHIPPED\"}" >/dev/null || true
  herdr-app do layout.switch "{\"name\":\"$1\"}" >/dev/null || true
}

# Build the layout clone. layout.clone also shows it, so when the edit fails, go
# back to the layout that was showing. If anything fails, a clone already there
# stays as it was. layout.clone drops the clicks made on a layout of that name, so
# they're put back and read again.
build_layout() {
  local shipped="$HERDR_HOME/layouts/$HERDR_LAYOUT_SHIPPED.json" file="$HERDR_HOME/layouts/$HERDR_LAYOUT.json" before
  local clicks="$HERDR_HOME/layouts/.state/$HERDR_LAYOUT.json" saved_clicks=""
  local args="{\"name\":\"$HERDR_LAYOUT_SHIPPED\",\"as\":\"$HERDR_LAYOUT\"}"
  if [[ ! -f "$shipped" ]]; then
    warn "$shipped not found: start herdr once, then re-run install"
    return 1
  fi
  if ! layout_edit_applies "$shipped" "$HERDR_LAYOUT_EDIT"; then
    warn_build_failed "$HERDR_LAYOUT_EDIT" "$HERDR_LAYOUT" "$file"
    return 1
  fi
  backup "$file"
  if ((DRY_RUN)); then
    run herdr-app do layout.clone "$args"
    info "[dry-run] would apply ${HERDR_LAYOUT_EDIT#"$REPO_DIR"/} to $file"
    return 0
  fi
  before="$(herdr_shown_layout)"
  if [[ -f "$clicks" ]]; then
    saved_clicks="$(mktemp)"
    cp -p "$clicks" "$saved_clicks"
  fi
  if ! herdr-app do layout.clone "$args" >/dev/null; then
    restore_backup "$file"
    rm -f "$saved_clicks"
    warn "herdr could not clone $HERDR_LAYOUT_SHIPPED as $HERDR_LAYOUT"
    return 1
  fi
  if [[ -n "$saved_clicks" ]]; then
    cp -p "$saved_clicks" "$clicks"
    rm -f "$saved_clicks"
  fi
  if ! edited_layout "$file" "$HERDR_LAYOUT_EDIT" "$file" 2>/dev/null; then
    restore_backup "$file"
    show_layout_afresh "$before"
    warn_build_failed "$HERDR_LAYOUT_EDIT" "$HERDR_LAYOUT" "$file"
    return 1
  fi
  if [[ -n "$saved_clicks" ]]; then
    show_layout_afresh "$HERDR_LAYOUT"
  fi
  info "built $HERDR_LAYOUT from $HERDR_LAYOUT_SHIPPED"
}

# The version the clone's JSON file $1 records, empty if it records none.
cloned_from_version() {
  py3 - "$1" <<'PY'
import json, sys

try:
    print(json.load(open(sys.argv[1]))["cloned_from"]["version"])
except (OSError, ValueError, KeyError, TypeError):
    print("")
PY
}

# Whether this is an update and $2, the version the build $1 came from, isn't the
# running herdr's. Says so, which is what a dry run reports.
outdated() {
  local what="$1" recorded="$2" running
  ((UPDATE)) || return 1
  running="$(herdr_running_version)"
  [[ "$recorded" != "$running" ]] || return 1
  info "$what came from herdr ${recorded:-of unknown version}, running $running"
}

changes_outdated() {
  [[ -f "$HERDR_CHANGES_JS" ]] || return 1
  outdated "Changes code" "$(sed -n "s|^// $HERDR_VERSION_MARK ||p" "$HERDR_CHANGES_JS")"
}

mod_clone_outdated() {
  [[ -d "$HERDR_HOME/mods/$1" ]] || return 1
  outdated "$1" "$(cloned_from_version "$HERDR_HOME/mods/$1/mod.json")"
}

layout_outdated() {
  [[ -f "$HERDR_HOME/layouts/$HERDR_LAYOUT.json" ]] || return 1
  outdated "$HERDR_LAYOUT" "$(cloned_from_version "$HERDR_HOME/layouts/$HERDR_LAYOUT.json")"
}

# Print, in the format of stale_entries, what the repo no longer lists and is
# still on this machine:
#   herdr-mod     dropped mod or clone, or a link into this repo whose target is gone
#   herdr-layout  dropped layout clone
# Only those named above qualify, so mods and layouts of the user's own never do,
# and neither does anything installed.json records as shipped.
herdr_stale_entries() {
  py3 - "$HERDR_HOME" "$REPO_DIR" "${HERDR_DROPPED_MODS[*]}" "${HERDR_DROPPED_LAYOUTS[*]}" <<'PY'
import json, os, sys
from pathlib import Path

home, repo, mods, layouts = Path(sys.argv[1]), sys.argv[2], sys.argv[3].split(), sys.argv[4].split()

try:
    shipped = set(json.loads((home / "installed.json").read_text()))
except (OSError, ValueError):
    shipped = set()

for name in mods:
    path = home / "mods" / name
    if name not in shipped and (path.exists() or path.is_symlink()):
        print(f"herdr-mod\t{path}")

for path in sorted((home / "mods").glob("*")):
    dangling = path.is_symlink() and not path.exists()
    if dangling and path.name not in mods and os.readlink(path).startswith(repo + "/"):
        print(f"herdr-mod\t{path}")

for name in layouts:
    path = home / "layouts" / f"{name}.json"
    if f"layout:{name}" not in shipped and path.exists():
        print(f"herdr-layout\t{path}")
PY
}

# The name of the showing layout, if the stale_entries lines $1 list it.
herdr_dropped_layout_showing() {
  local shown
  if herdr-app status >/dev/null 2>&1; then
    shown="$(herdr_window_layout)"
  else
    shown="$(herdr_shown_layout)"
  fi
  if grep -qxF "$(printf 'herdr-layout\t%s' "$HERDR_HOME/layouts/$shown.json")" <<<"$1"; then
    printf '%s' "$shown"
  fi
}

# Show a layout that stays if the one showing is about to be removed. Returns 1
# if that didn't happen: the mods and layout it uses must then stay too.
herdr_leave_dropped_layout() {
  local shown target="$HERDR_LAYOUT_SHIPPED"
  shown="$(herdr_dropped_layout_showing "$1")"
  [[ -n "$shown" ]] || return 0
  if ! herdr-app status >/dev/null 2>&1; then
    warn "$shown is showing and herdr isn't open: keeping the herdr files. Open it and re-run install"
    return 1
  fi
  if [[ -f "$HERDR_HOME/layouts/$HERDR_LAYOUT.json" ]]; then
    target="$HERDR_LAYOUT"
  fi
  if ! herdr-app do layout.switch "{\"name\":\"$target\"}" >/dev/null; then
    warn "herdr could not switch away from $shown: keeping the herdr files"
    return 1
  fi
  # layout.switch answers ok even when it didn't switch, so ask what's showing.
  shown="$(herdr_window_layout)"
  if [[ "$shown" != "$target" ]]; then
    warn "herdr still shows $shown, not $target: keeping the herdr files"
    return 1
  fi
  info "switched herdr to $target"
}

# Whether everything the layout depends on is there, built from the right herdr.
herdr_all_built() {
  local spec _shipped clone _patch
  [[ -f "$HERDR_CHANGES_JS" && -f "$HERDR_HOME/layouts/$HERDR_LAYOUT.json" ]] || return 1
  changes_outdated >/dev/null && return 1
  layout_outdated >/dev/null && return 1
  for spec in "${HERDR_MOD_CLONES[@]}"; do
    read -r _shipped clone _patch <<<"$spec"
    [[ -d "$HERDR_HOME/mods/$clone" ]] || return 1
    mod_clone_outdated "$clone" >/dev/null && return 1
  done
  return 0
}

# Run herdr's official installer for this platform.
run_herdr_installer() {
  local script status=0
  if is_windows; then
    powershell -c "irm $HERDR_INSTALLER_PS1 | iex" </dev/null
    return
  fi
  require curl "herdr installer" || return 1
  # Not piped into sh: a download cut short must not run as half a script.
  script="$(mktemp)"
  if curl -fsSL -o "$script" "$HERDR_INSTALLER_SH"; then
    sh "$script" </dev/null || status=$?
  else
    status=$?
  fi
  rm -f "$script"
  return "$status"
}

# Make herdr-app available to the rest of the run, installing it if it's missing.
# Returns 1 if that fails. The installer's folders may not be on this shell's PATH.
install_herdr_app() {
  PATH="$PATH:$HOME/.local/bin"
  if [[ -n "${LOCALAPPDATA:-}" ]] && command -v cygpath >/dev/null 2>&1; then
    PATH="$PATH:$(cygpath -u "$LOCALAPPDATA")/Programs/herdr-app"
  fi
  command -v herdr-app >/dev/null 2>&1 && return 0
  if ((DRY_RUN)); then
    if is_windows; then
      info "[dry-run] would install herdr from $HERDR_INSTALLER_PS1"
    else
      info "[dry-run] would install herdr from $HERDR_INSTALLER_SH"
    fi
    return 0
  fi
  if run_herdr_installer && command -v herdr-app >/dev/null 2>&1; then
    info "installed herdr $(herdr_version)"
    return 0
  fi
  warn "could not install herdr: skipping the Git panel"
  return 1
}

# Install gh with the first tool that can do it without a prompt. A machine with
# none still gets the panel: its PR sections say how to fix it.
install_gh() {
  command -v gh >/dev/null 2>&1 && return 0
  local status=0
  if command -v brew >/dev/null 2>&1; then
    run brew install gh </dev/null || status=$?
  elif command -v winget >/dev/null 2>&1; then
    run winget install --id GitHub.cli --exact --silent --accept-package-agreements --accept-source-agreements </dev/null || status=$?
  elif command -v apt-get >/dev/null 2>&1 && command -v sudo >/dev/null 2>&1 && sudo -n true 2>/dev/null; then
    {
      run sudo -n apt-get update -qq &&
        run sudo -n env DEBIAN_FRONTEND=noninteractive apt-get install -y gh
    } </dev/null || status=$?
  else
    info "gh not installed: no way to install it here without a prompt"
    return 0
  fi
  if ((status != 0)); then
    warn "could not install gh"
  fi
}

# Whether the files herdr ships, which everything is built from, are there.
herdr_shipped_present() {
  local spec shipped _clone _patch
  [[ -f "$HERDR_HOME/mods/changes/main.js" && -f "$HERDR_HOME/layouts/$HERDR_LAYOUT_SHIPPED.json" ]] || return 1
  for spec in "${HERDR_MOD_CLONES[@]}"; do
    read -r shipped _clone _patch <<<"$spec"
    [[ -f "$HERDR_HOME/mods/$shipped/main.js" ]] || return 1
  done
}

# Ask the window for its status. Returns 0 if it answers, or the failure's code:
# HERDR_STATUS_STUCK if it didn't answer in time. status blocks while the app
# starts, and macOS has no `timeout` command.
herdr_status() {
  local pid checks=0 max_checks=$((HERDR_STATUS_CALL_SECS * 10))
  herdr-app status >/dev/null 2>&1 &
  pid=$!
  while kill -0 "$pid" 2>/dev/null; do
    if ((checks >= max_checks)); then
      kill "$pid" 2>/dev/null || true
      wait "$pid" 2>/dev/null || true
      return "$HERDR_STATUS_STUCK"
    fi
    checks=$((checks + 1))
    sleep 0.1
  done
  wait "$pid"
}

# Make sure a window is answering, starting one unless one is already there but
# slow. Returns 1 if none answers in time. Starts nothing on a dry run.
herdr_window_ready() {
  local code=0 window_log="" deadline
  herdr_status || code=$?
  if ((code == 0)); then
    return 0
  fi
  if ((DRY_RUN)); then
    info "[dry-run] would start herdr and poll herdr-app status for up to ${HERDR_WINDOW_WAIT_SECS}s"
    return 0
  fi
  if ((code != HERDR_STATUS_STUCK)); then
    window_log="$(mktemp)"
    info "starting herdr"
    nohup herdr-app >"$window_log" 2>&1 </dev/null &
  fi
  deadline=$((SECONDS + HERDR_WINDOW_WAIT_SECS))
  until herdr_status; do
    if ((SECONDS >= deadline)); then
      warn "herdr didn't answer within ${HERDR_WINDOW_WAIT_SECS}s: open it and re-run install to finish the Git panel"
      if [[ -n "$window_log" ]]; then
        warn "its output is in $window_log"
      fi
      return 1
    fi
    sleep 0.2
  done
  if [[ -n "$window_log" ]]; then
    rm -f "$window_log" || true
  fi
}

# What a dry run can say before herdr has shipped anything to check patches against.
preview_first_build() {
  local spec shipped clone patch
  info "[dry-run] herdr's shipped files aren't there yet, so the patches can't be checked"
  info "[dry-run] would generate $HERDR_CHANGES_JS"
  for spec in "${HERDR_MOD_CLONES[@]}"; do
    read -r shipped clone patch <<<"$spec"
    run herdr-app do mod.clone "{\"name\":\"$shipped\",\"as\":\"$clone\"}"
    info "[dry-run] would apply herdr/patches/$patch to $HERDR_HOME/mods/$clone/main.js"
  done
  run herdr-app do layout.clone "{\"name\":\"$HERDR_LAYOUT_SHIPPED\",\"as\":\"$HERDR_LAYOUT\"}"
  info "[dry-run] would apply ${HERDR_LAYOUT_EDIT#"$REPO_DIR"/} to $HERDR_HOME/layouts/$HERDR_LAYOUT.json"
  run herdr-app do layout.switch "{\"name\":\"$HERDR_LAYOUT\"}"
}

# The last thing a run says: the one step install can't do for the person. Only
# when this machine gets the panel, the only thing here that needs gh.
remind_gh_sign_in() {
  ((HERDR_PANEL_WANTED)) || return 0
  if ! command -v gh >/dev/null 2>&1; then
    if ((DRY_RUN)); then
      info "[dry-run] once gh is installed, run \`gh auth login\`"
    else
      warn "for the PR sections, install gh (https://cli.github.com), then run \`gh auth login\`"
    fi
  elif ! gh_signed_in; then
    warn "for the PR sections, run \`gh auth login\`"
  fi
}

# Any gh call records a device id in its state folder, and a dry run leaves the
# home alone, so that folder goes somewhere temporary for the check.
gh_signed_in() {
  ((DRY_RUN)) || { gh auth status >/dev/null 2>&1; return; }
  local state code
  state="$(mktemp -d)"
  XDG_STATE_HOME="$state" gh auth status >/dev/null 2>&1
  code=$?
  rm -rf "$state"
  return "$code"
}

# Build whatever is missing and, on an update, rebuild whatever an older herdr
# built, then show the layout. Stays on the current layout if a piece can't be
# built and has no earlier build; a piece with an earlier build keeps it.
install_herdr() {
  if herdr_has_no_display; then
    log "Herdr Git panel: skipped, no DISPLAY or WAYLAND_DISPLAY"
    return 0
  fi
  log "Herdr Git panel ($HERDR_HOME)"
  install_herdr_app || return 0
  HERDR_PANEL_WANTED=1
  install_gh
  require_python "Git panel" || return 0
  require patch "Git panel" || return 0

  link_herdr_mods
  copy_herdr_mod_icons

  local ready=1 spec shipped clone patch
  # Generating the Changes code needs herdr's files but no window.
  if [[ ! -f "$HERDR_CHANGES_JS" && -f "$HERDR_HOME/mods/changes/main.js" ]] && command -v herdr-app >/dev/null 2>&1; then
    build_changes || ready=0
  fi
  if herdr_all_built && herdr_shipped_present && [[ "$(herdr_shown_layout)" == "$HERDR_LAYOUT" ]]; then
    info "$HERDR_LAYOUT is active"
    return 0
  fi

  # Everything below goes through the open window, and herdr writes its shipped
  # files on first launch: by the time status answers, they're there.
  herdr_window_ready || return 0
  if ((DRY_RUN)) && { ! command -v herdr-app >/dev/null 2>&1 || ! herdr_shipped_present; }; then
    preview_first_build
    return 0
  fi
  if ((ready && !DRY_RUN)) && [[ ! -f "$HERDR_CHANGES_JS" ]]; then
    build_changes || ready=0
  fi

  # Shipped files are only this version's once its window has started, so this
  # waits for the window even though it doesn't go through it.
  if changes_outdated; then
    build_changes || true
  fi
  for spec in "${HERDR_MOD_CLONES[@]}"; do
    read -r shipped clone patch <<<"$spec"
    if [[ ! -d "$HERDR_HOME/mods/$clone" ]] || mod_clone_outdated "$clone"; then
      build_mod_clone "$shipped" "$clone" "$patch" || [[ -d "$HERDR_HOME/mods/$clone" ]] || ready=0
    fi
  done
  if ((!ready)); then
    return 0
  fi
  if [[ ! -f "$HERDR_HOME/layouts/$HERDR_LAYOUT.json" ]] || layout_outdated; then
    build_layout || [[ -f "$HERDR_HOME/layouts/$HERDR_LAYOUT.json" ]] || return 0
  fi
  if [[ "$(herdr_shown_layout)" != "$HERDR_LAYOUT" ]]; then
    run herdr-app do layout.switch "{\"name\":\"$HERDR_LAYOUT\"}"
  fi
  if ((DRY_RUN)); then
    return 0
  fi
  # layout.switch answers ok even when it didn't switch, so ask what's showing.
  local shown
  shown="$(herdr_window_layout)"
  if [[ "$shown" == "$HERDR_LAYOUT" ]]; then
    info "$HERDR_LAYOUT is active"
  else
    warn "herdr still shows $shown, not $HERDR_LAYOUT"
  fi
}
