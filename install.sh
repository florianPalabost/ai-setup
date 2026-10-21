#!/usr/bin/env bash
# Install this AI setup on the current machine.
#
# Idempotent: safe to re-run. It only adds or links things; anything it would
# replace is moved to a timestamped backup directory first, never deleted.
#
# Usage: ./install.sh [--dry-run]

set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CLAUDE_DIR="${CLAUDE_CONFIG_DIR:-$HOME/.claude}"
CONFIG_DIR="${XDG_CONFIG_HOME:-$HOME/.config}/ai-setup"
VENDOR_DIR="${XDG_DATA_HOME:-$HOME/.local/share}/ai-setup/vendor"
BACKUP_DIR="$CLAUDE_DIR/backups/ai-setup-$(date +%Y%m%d-%H%M%S)"
DRY_RUN=0

usage() {
  sed -n '2,8p' "$0" | sed 's/^# \{0,1\}//'
}

for arg in "$@"; do
  case "$arg" in
    --dry-run) DRY_RUN=1 ;;
    -h | --help) usage; exit 0 ;;
    *) echo "Unknown option: $arg" >&2; usage >&2; exit 1 ;;
  esac
done

log() { printf '\033[1;34m==>\033[0m %s\n' "$*"; }
info() { printf '    %s\n' "$*"; }
warn() { printf '\033[1;33m!!\033[0m  %s\n' "$*" >&2; }

run() {
  if ((DRY_RUN)); then
    printf '    [dry-run] %s\n' "$*"
  else
    "$@"
  fi
}

require() {
  if ! command -v "$1" >/dev/null 2>&1; then
    warn "'$1' not found, skipping: $2"
    return 1
  fi
}

# Strip comments and blank lines from a manifest.
manifest_lines() {
  sed -e 's/#.*//' -e '/^[[:space:]]*$/d' "$1"
}

# Move an existing file/dir/link out of the way, keeping its path under $HOME.
backup() {
  local target="$1" rel
  [[ -e "$target" || -L "$target" ]] || return 0
  rel="${target#"$HOME"/}"
  run mkdir -p "$BACKUP_DIR/$(dirname "$rel")"
  run mv "$target" "$BACKUP_DIR/$rel"
  info "backed up $target"
}

link() {
  local src="$1" dst="$2"
  if [[ -L "$dst" && "$(readlink "$dst")" == "$src" ]]; then
    return 0
  fi
  backup "$dst"
  run mkdir -p "$(dirname "$dst")"
  run ln -s "$src" "$dst"
  info "linked $dst -> $src"
}

link_global() {
  log "Global instructions"
  link "$REPO_DIR/global/AGENTS.md" "$CLAUDE_DIR/AGENTS.md"
  link "$REPO_DIR/global/CLAUDE.md" "$CLAUDE_DIR/CLAUDE.md"
}

# settings.json is merged, not symlinked: tools like Orca write their own hooks
# into it, and those must never end up in the repo.
merge_settings() {
  log "Settings (merge global/settings.json into $CLAUDE_DIR/settings.json)"
  require python3 "settings merge" || return 0

  python3 - "$REPO_DIR/global/settings.json" "$CLAUDE_DIR/settings.json" "$BACKUP_DIR" "$DRY_RUN" <<'PY'
import json, shutil, sys
from pathlib import Path

src, dst, backup_dir, dry_run = Path(sys.argv[1]), Path(sys.argv[2]), Path(sys.argv[3]), sys.argv[4] == "1"

def merge(base, extra):
    for key, value in extra.items():
        if isinstance(value, dict) and isinstance(base.get(key), dict):
            merge(base[key], value)
        elif isinstance(value, list) and isinstance(base.get(key), list):
            base[key] += [item for item in value if item not in base[key]]
        else:
            base[key] = value
    return base

current = json.loads(dst.read_text()) if dst.exists() else {}
merged = merge(json.loads(json.dumps(current)), json.loads(src.read_text()))

if merged == current:
    print("    already up to date")
elif dry_run:
    print("    [dry-run] would update keys:", ", ".join(k for k in merged if merged[k] != current.get(k)))
else:
    if dst.exists():
        backup_dir.mkdir(parents=True, exist_ok=True)
        shutil.copy2(dst, backup_dir / "settings.json")
        print("    backed up", dst)
    dst.parent.mkdir(parents=True, exist_ok=True)
    dst.write_text(json.dumps(merged, indent=2) + "\n")
    print("    updated", dst)
PY
}

link_own_plugins() {
  log "Own skills, commands and agents (symlinked from plugins/)"
  local item
  shopt -s nullglob
  for item in "$REPO_DIR"/plugins/*/skills/*/; do
    item="${item%/}"
    link "$item" "$CLAUDE_DIR/skills/$(basename "$item")"
  done
  for item in "$REPO_DIR"/plugins/*/commands/*.md; do
    link "$item" "$CLAUDE_DIR/commands/$(basename "$item")"
  done
  for item in "$REPO_DIR"/plugins/*/agents/*.md; do
    link "$item" "$CLAUDE_DIR/agents/$(basename "$item")"
  done
  shopt -u nullglob
}

install_plugins() {
  log "Plugins (manifests/plugins.txt)"
  require claude "plugins" || return 0
  require python3 "plugins" || return 0

  local marketplaces installed
  marketplaces="$(claude plugin marketplace list --json | python3 -c 'import json,sys; print("\n".join(m["name"] for m in json.load(sys.stdin)))')"
  installed="$(claude plugin list --json | python3 -c 'import json,sys; print("\n".join(p["id"] for p in json.load(sys.stdin) if p["scope"] == "user"))')"

  local plugin repo state marketplace
  while read -r plugin repo state; do
    marketplace="${plugin#*@}"
    if ! grep -qxF "$marketplace" <<<"$marketplaces"; then
      run claude plugin marketplace add "$repo"
      marketplaces+=$'\n'"$marketplace"
    fi
    if ! grep -qxF "$plugin" <<<"$installed"; then
      run claude plugin install --scope user "$plugin"
    fi
    if [[ "$state" == "disabled" ]]; then
      run claude plugin disable --scope user "$plugin" >/dev/null 2>&1 || true
    else
      run claude plugin enable --scope user "$plugin" >/dev/null 2>&1 || true
    fi
    info "$plugin ${state:-enabled}"
  done < <(manifest_lines "$REPO_DIR/manifests/plugins.txt")
}

install_git_skill() {
  local url="$1" path="$2" name dest cmd
  name="$(basename "$url" .git)"
  dest="$VENDOR_DIR/$name"

  if [[ -d "$dest/.git" ]]; then
    run git -C "$dest" pull --ff-only --quiet
  else
    run mkdir -p "$VENDOR_DIR"
    run git clone --depth 1 --quiet "$url" "$dest"
  fi

  link "$dest/$path" "$CLAUDE_DIR/skills/$(basename "$path")"
  shopt -s nullglob
  for cmd in "$dest/$path"/commands/*.md; do
    link "$cmd" "$CLAUDE_DIR/commands/$(basename "$cmd")"
  done
  shopt -u nullglob
}

install_skills() {
  log "Third-party skills (manifests/skills.txt)"
  local type source target
  while read -r type source target; do
    case "$type" in
      skills)
        if [[ -e "$CLAUDE_DIR/skills/$target" ]]; then
          info "$target already installed"
        elif require npx "skill $target"; then
          run npx -y skills add "$source" --global --yes --agent claude-code --skill "$target"
        fi
        ;;
      git)
        require git "skill $source" && install_git_skill "$source" "$target"
        ;;
      *) warn "unknown skill type '$type' in manifests/skills.txt" ;;
    esac
  done < <(manifest_lines "$REPO_DIR/manifests/skills.txt")
}

setup_env_and_mcp() {
  log "Env file and MCP servers"
  local env_file="$CONFIG_DIR/.env"
  if [[ ! -f "$env_file" ]]; then
    run mkdir -p "$CONFIG_DIR"
    run cp "$REPO_DIR/templates/.env.example" "$env_file"
    run chmod 600 "$env_file"
    info "created $env_file, fill in your keys and re-run"
    return 0
  fi

  local CONTEXT7_API_KEY=""
  # shellcheck source=/dev/null
  source "$env_file"
  if [[ -z "$CONTEXT7_API_KEY" ]]; then
    info "CONTEXT7_API_KEY empty in $env_file, skipping context7"
  elif ! require claude "MCP servers"; then
    return 0
  elif claude mcp get context7 >/dev/null 2>&1; then
    info "context7 already registered"
  else
    run claude mcp add --scope user --transport http context7 https://mcp.context7.com/mcp \
      --header "CONTEXT7_API_KEY: $CONTEXT7_API_KEY"
  fi
}

main() {
  ((DRY_RUN)) && log "Dry run: nothing will be changed"
  link_global
  merge_settings
  link_own_plugins
  install_plugins
  install_skills
  setup_env_and_mcp
  [[ -d "$BACKUP_DIR" ]] && log "Backups saved in $BACKUP_DIR"
  log "Done"
}

main
