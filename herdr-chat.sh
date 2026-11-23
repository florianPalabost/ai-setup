# shellcheck shell=bash

HERDR_CHAT_INSTALLER_SH="https://raw.githubusercontent.com/ChmaraX/herdr-chat/main/install.sh"
HERDR_CHAT_DIR="${XDG_DATA_HOME:-$HOME/.local/share}/herdr-chat"

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

# herdr-chat edits the showing layout, so a rebuilt main-git needs its installer again.
install_herdr_chat() {
  if is_windows; then
    info "Chat: install herdr-chat by hand on Windows (https://github.com/ChmaraX/herdr-chat)"
    return 0
  fi
  if herdr_chat_installed && ((!UPDATE)) && ! herdr_layout_rebuilt; then
    info "herdr-chat is installed"
    return 0
  fi
  run_herdr_chat_installer || warn "could not install herdr-chat (see above)"
}

uninstall_herdr_chat() {
  herdr_chat_installed || return 0
  run_herdr_chat_installer --uninstall || warn "could not uninstall herdr-chat (see above)"
}

sync_herdr_chat() {
  if herdr_chosen chat; then
    install_herdr_chat
  else
    uninstall_herdr_chat
  fi
}
