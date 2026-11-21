# shellcheck shell=bash
# The Automations feature's binary: herdr-automations schedules the prompts the
# panel shows and keeps their files. Sourced by install.sh after herdr.sh, whose
# HERDR_SRC it uses.

AUTOMATIONS_REPO="DnzzL/herdr-automations"
# Records the release the vendored mod came from, which the binary must match.
AUTOMATIONS_UPSTREAM="$HERDR_SRC/mods/automations/UPSTREAM"
AUTOMATIONS_BIN="$HOME/.local/bin/herdr-automations"
AUTOMATIONS_CHECKSUMS="checksums.txt"

# The release tag UPSTREAM records, e.g. v0.14.0.
automations_tag() {
  awk '$1 == "tag" { print $2 }' "$AUTOMATIONS_UPSTREAM"
}

# The release asset for this OS and arch. Returns 1 where there is none.
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

# Whether the installed binary is the release $1 (vX.Y.Z; it prints X.Y.Z).
automations_bin_is() {
  [[ -x "$AUTOMATIONS_BIN" ]] && [[ "$("$AUTOMATIONS_BIN" version 2>/dev/null)" == "${1#v}" ]]
}

# Download the release $1's asset for this machine and install it as
# AUTOMATIONS_BIN, refusing it unless it matches the release's checksums.
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

# The starter config: runs open in the Herdr app (backend: hc), and the two
# examples stay off until ticked in the panel.
AUTOMATIONS_STARTER='backend: hc
automations:
  - name: issue-triage
    cron: "0 9 * * 1-5"
    repo: ~/Documents/dev/ai-setup
    agent: claude
    model: sonnet
    prompt: |
      Run /triage on the GitHub issues opened since the last run that have no
      triage label yet.
    disabled: true

  - name: weekly-review
    cron: "0 17 * * 5"
    repo: ~/Documents/dev/ai-setup
    workspace: root
    agent: claude
    model: sonnet
    prompt: |
      Run /code-review on this week'"'"'s commits on main
      (git log --since="1 week ago" main).
    disabled: true
'

# The automations.yaml the binary reads.
automations_config_path() {
  "$AUTOMATIONS_BIN" ls --json 2>/dev/null | py3 -c 'import json, sys; print(json.load(sys.stdin)["config"])'
}

# Write the starter config if there is none. If there is one, only put
# `backend: hc` at its top when it sets no backend: without it, runs go to the
# herdr TUI, not the app.
seed_automations_config() {
  local path
  if ((DRY_RUN)) && [[ ! -x "$AUTOMATIONS_BIN" ]]; then
    info "[dry-run] would write a starter automations.yaml (backend: hc, two disabled examples)"
    return 0
  fi
  if ! path="$(automations_config_path)" || [[ -z "$path" ]]; then
    warn "herdr-automations didn't name its automations.yaml: set \`backend: hc\` at its top by hand"
    return 0
  fi
  if [[ ! -f "$path" ]]; then
    if ((DRY_RUN)); then
      info "[dry-run] would write a starter $path"
    else
      mkdir -p "$(dirname "$path")"
      printf '%s' "$AUTOMATIONS_STARTER" >"$path"
      info "wrote a starter $path, its examples disabled"
    fi
  elif ! grep -q '^backend:' "$path"; then
    if ((DRY_RUN)); then
      info "[dry-run] would put backend: hc at the top of $path"
    else
      backup "$path"
      printf 'backend: hc\n' | cat - "$BACKUP_DIR/${path#"$HOME"/}" >"$path"
      info "put backend: hc at the top of $path"
    fi
  fi
}

# Whether the scheduler service is installed. Without the binary, it can't be.
automations_service_installed() {
  [[ -x "$AUTOMATIONS_BIN" ]] && "$AUTOMATIONS_BIN" service status 2>/dev/null | grep -qx 'service installed: true'
}

# Install the binary of the vendored release if it isn't there, then the
# scheduler service. A new binary reinstalls the service, which points at it.
install_automations() {
  local tag fresh=0
  if is_windows; then
    info "Automations: install herdr-automations by hand on Windows (see its README), then run \`herdr-automations service install\`"
    return 0
  fi
  tag="$(automations_tag)"
  if ! automations_bin_is "$tag"; then
    download_automations_bin "$tag" || return 0
    fresh=1
  fi
  seed_automations_config
  if ((fresh)) || ! automations_service_installed; then
    automations_service install "installed"
  fi
}

# Remove the scheduler service of an unticked feature. The binary, the
# automations and their history stay.
uninstall_automations() {
  automations_service_installed || return 0
  automations_service uninstall "removed"
}

# Run `herdr-automations service $1` and say the service was $2.
automations_service() {
  if ((DRY_RUN)); then
    info "[dry-run] would run herdr-automations service $1"
  elif "$AUTOMATIONS_BIN" service "$1" >/dev/null; then
    info "$2 the herdr-automations scheduler service"
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
