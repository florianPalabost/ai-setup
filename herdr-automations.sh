# shellcheck shell=bash

AUTOMATIONS_REPO="DnzzL/herdr-automations"
AUTOMATIONS_UPSTREAM_FILE="$HERDR_SRC/mods/automations/UPSTREAM"
AUTOMATIONS_BIN="$HOME/.local/bin/herdr-automations"
AUTOMATIONS_CHECKSUMS="checksums.txt"
# Without it, runs go to the herdr TUI, not the app.
AUTOMATIONS_BACKEND_LINE="backend: hc"

upstream_automations_tag() {
  awk '$1 == "tag" { print $2 }' "$AUTOMATIONS_UPSTREAM_FILE"
}

automations_asset() {
  local os arch
  case "$(uname -s)" in
    Darwin) os=darwin ;;
    Linux) os=linux ;;
    *) return 1 ;;
  esac
  case "$(uname -m)" in
    arm64 | aarch64) arch=arm64 ;;
    x86_64 | amd64) arch=amd64 ;;
    *) return 1 ;;
  esac
  printf 'herdr-automations_%s_%s' "$os" "$arch"
}

sha256_of() {
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$1" | cut -d' ' -f1
  elif command -v shasum >/dev/null 2>&1; then
    shasum -a 256 "$1" | cut -d' ' -f1
  fi
}

automations_bin_is_release() {
  [[ -x "$AUTOMATIONS_BIN" ]] && [[ "$("$AUTOMATIONS_BIN" version 2>/dev/null)" == "${1#v}" ]]
}

download_automations_bin() {
  local tag="$1" asset base dir expected actual status=0
  if ! asset="$(automations_asset)"; then
    warn "herdr-automations has no release for $(uname -s) $(uname -m): install it by hand"
    return 1
  fi
  require curl "herdr-automations download" || return 1
  base="https://github.com/$AUTOMATIONS_REPO/releases/download/$tag"
  if ((DRY_RUN)); then
    info "[dry-run] would download $base/$asset, check it against $AUTOMATIONS_CHECKSUMS and install it as $AUTOMATIONS_BIN"
    return 0
  fi
  dir="$(mktemp -d)"
  if ! curl -fsSL -o "$dir/$asset" "$base/$asset" || ! curl -fsSL -o "$dir/$AUTOMATIONS_CHECKSUMS" "$base/$AUTOMATIONS_CHECKSUMS"; then
    warn "could not download herdr-automations $tag"
    status=1
  else
    expected="$(awk -v asset="$asset" '$2 == asset { print $1 }' "$dir/$AUTOMATIONS_CHECKSUMS")"
    actual="$(sha256_of "$dir/$asset")"
    if [[ -z "$actual" ]]; then
      warn "no sha256sum or shasum to check herdr-automations with: not installed"
      status=1
    elif [[ -z "$expected" || "$actual" != "$expected" ]]; then
      warn "herdr-automations $tag doesn't match its $AUTOMATIONS_CHECKSUMS: refusing it"
      status=1
    else
      mkdir -p "$(dirname "$AUTOMATIONS_BIN")"
      install -m 755 "$dir/$asset" "$AUTOMATIONS_BIN"
      info "installed herdr-automations $tag in $AUTOMATIONS_BIN"
    fi
  fi
  rm -rf "$dir"
  return "$status"
}

AUTOMATIONS_STARTER="$AUTOMATIONS_BACKEND_LINE"'
automations:
  - name: issue-triage
    cron: "0 9 * * 1-5"
    repo: '"${REPO_DIR/#"$HOME"/\~}"'
    agent: claude
    model: sonnet
    prompt: |
      Run /triage on the GitHub issues opened since the last run that have no
      triage label yet.
    disabled: true

  - name: weekly-review
    cron: "0 17 * * 5"
    repo: '"${REPO_DIR/#"$HOME"/\~}"'
    workspace: root
    agent: claude
    model: sonnet
    prompt: |
      Run /code-review on this week'"'"'s commits on main
      (git log --since="1 week ago" main).
    disabled: true
'

automations_listing() {
  "$AUTOMATIONS_BIN" ls --json 2>/dev/null | py3 -c 'import json, sys; print(json.load(sys.stdin)[sys.argv[1]])' "$1"
}

# The service appends its log to a file in the state folder, and systemd can't
# start it while that folder is missing.
make_automations_state_dir() {
  local dir
  if dir="$(automations_listing state)" && [[ -n "$dir" ]]; then
    [[ -d "$dir" ]] || run mkdir -p "$dir"
  elif ((DRY_RUN)); then
    info "[dry-run] would create the herdr-automations state folder"
  fi
}

seed_automations_config() {
  local path
  if ((DRY_RUN)) && [[ ! -x "$AUTOMATIONS_BIN" ]]; then
    info "[dry-run] would write a starter automations.yaml ($AUTOMATIONS_BACKEND_LINE, two disabled examples)"
    return 0
  fi
  if ! path="$(automations_listing config)" || [[ -z "$path" ]]; then
    warn "herdr-automations didn't name its automations.yaml: put \`$AUTOMATIONS_BACKEND_LINE\` at its top by hand"
    return 0
  fi
  if [[ ! -f "$path" ]] && ((DRY_RUN)); then
    info "[dry-run] would write a starter $path, its examples disabled"
  elif [[ ! -f "$path" ]]; then
    mkdir -p "$(dirname "$path")"
    printf '%s' "$AUTOMATIONS_STARTER" >"$path"
    info "wrote a starter $path, its examples disabled"
  elif ! grep -q '^backend:' "$path"; then
    backup "$path"
    run_to "$path" prepend_line "$AUTOMATIONS_BACKEND_LINE" "$BACKUP_DIR/${path#"$HOME"/}"
    ((DRY_RUN)) || info "put $AUTOMATIONS_BACKEND_LINE at the top of $path"
  fi
}

prepend_line() {
  printf '%s\n' "$1"
  cat "$2"
}

automations_service_installed() {
  [[ -x "$AUTOMATIONS_BIN" ]] && "$AUTOMATIONS_BIN" service status 2>/dev/null | grep -qx 'service installed: true'
}

automations_scheduler_running() {
  "$AUTOMATIONS_BIN" service status 2>/dev/null | grep -q '^scheduler running: true'
}

install_automations() {
  local tag new_binary=0
  if is_windows; then
    info "Automations: install herdr-automations by hand on Windows (see its README), then run \`herdr-automations service install\`"
    return 0
  fi
  tag="$(upstream_automations_tag)"
  if ! automations_bin_is_release "$tag"; then
    download_automations_bin "$tag" || return 0
    new_binary=1
  fi
  seed_automations_config
  make_automations_state_dir
  if ((!new_binary)) && automations_service_installed; then
    automations_scheduler_running && return 0
    warn "the herdr-automations scheduler isn't running (see daemon.log in $(automations_listing state)): reinstalling its service"
  fi
  automations_service install
  if ((!DRY_RUN)) && ! automations_scheduler_running; then
    sleep 1
    automations_scheduler_running || warn "the herdr-automations scheduler still isn't running: see \`systemctl --user status herdr-automations\`"
  fi
}

uninstall_automations() {
  automations_service_installed || return 0
  automations_service uninstall
}

automations_service() {
  if ((DRY_RUN)); then
    info "[dry-run] would run herdr-automations service $1"
  elif "$AUTOMATIONS_BIN" service "$1" >/dev/null; then
    info "ran herdr-automations service $1"
  else
    warn "herdr-automations service $1 failed"
  fi
}

sync_automations() {
  if herdr_chosen automations; then
    install_automations
  else
    uninstall_automations
  fi
}
