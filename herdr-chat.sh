# shellcheck shell=bash

HERDR_CHAT_INSTALLER_SH="https://raw.githubusercontent.com/ChmaraX/herdr-chat/main/install.sh"
HERDR_CHAT_DIR="${XDG_DATA_HOME:-$HOME/.local/share}/herdr-chat"
HERDR_CHAT_DATA="$HERDR_HOME/data/herdr-chat"
HERDR_CHAT_KEYS="$HERDR_SRC/chat/keys.json"
# herdr-chat's own mods, which herdr doesn't restore, patched in place after its
# installer copies herdr's agents and menu into them. "<mod> <file> <patch in herdr/patches/>"
HERDR_CHAT_PATCHES=("chat-agents agents-base.js chat-agents.patch" "chat-menu menu-base.js chat-menu.patch" "chat-menu menu-base.js chat-menu-clipboard.patch")

herdr_chat_installed() {
  [[ -f "$HERDR_CHAT_DIR/current/install/app.sh" ]]
}

run_herdr_chat_installer() {
  local script status=0
  require curl "herdr-chat installer" || return 1
  if ((DRY_RUN)); then
    run sh "<$HERDR_CHAT_INSTALLER_SH>" --app "$@"
    return 0
  fi
  script="$(mktemp)"
  if curl -fsSL -o "$script" "$HERDR_CHAT_INSTALLER_SH"; then
    PATH="$PATH:$HOME/.local/bin" sh "$script" --app "$@" </dev/null || status=$?
  else
    status=$?
  fi
  rm -f "$script"
  return "$status"
}

# herdr-chat writes its keys into Herdr's keys.json only when its installer runs,
# so a chord in herdr/chat/keys.json it hasn't bound yet needs the installer again.
herdr_chat_keys_bound() {
  py3 - "$HERDR_CHAT_KEYS" "$HERDR_CHAT_DATA/install.json" <<'PY'
import json, sys
from pathlib import Path

wanted, record = Path(sys.argv[1]), Path(sys.argv[2])
chords = set()
for value in json.loads(wanted.read_text()).get("global", {}).values():
    chords.update([value] if isinstance(value, str) else value or [])
bound = json.loads(record.read_text()).get("global", {}) if record.is_file() else {}
sys.exit(0 if chords <= bound.keys() else 1)
PY
}

# herdr-chat edits the showing layout, so a rebuilt main-git needs its installer again.
install_herdr_chat() {
  if is_windows; then
    info "Chat: install herdr-chat by hand on Windows (https://github.com/ChmaraX/herdr-chat)"
    return 0
  fi
  link "$HERDR_CHAT_KEYS" "$HERDR_CHAT_DATA/keys.json"
  if herdr_chat_installed && ((!UPDATE)) && ! herdr_layout_rebuilt && herdr_chat_keys_bound; then
    info "herdr-chat is installed"
    return 0
  fi
  run_herdr_chat_installer || warn "could not install herdr-chat (see above)"
}

patch_herdr_chat_mods() {
  local spec mod file patch path
  for spec in "${HERDR_CHAT_PATCHES[@]}"; do
    read -r mod file patch <<<"$spec"
    path="$HERDR_HOME/mods/$mod/$file"
    patch="$HERDR_SRC/patches/$patch"
    if [[ ! -f "$path" ]] || patch_applied "$path" "$patch"; then
      continue
    fi
    if ! patch_applies "$path" "$patch"; then
      warn "${patch#"$REPO_DIR"/} no longer applies to herdr-chat's $mod: left as it is"
      continue
    fi
    if ((DRY_RUN)); then
      info "[dry-run] would apply ${patch#"$REPO_DIR"/} to $path"
      continue
    fi
    patched_copy "$path" "$patch" "$path"
    info "patched $path"
  done
}

uninstall_herdr_chat() {
  herdr_chat_installed || return 0
  run_herdr_chat_installer --uninstall || warn "could not uninstall herdr-chat (see above)"
}

sync_herdr_chat() {
  if herdr_chosen chat; then
    install_herdr_chat
    patch_herdr_chat_mods
  else
    uninstall_herdr_chat
  fi
}
