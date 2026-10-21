#!/usr/bin/env bash
# Install this AI setup on the current machine.
#
# Idempotent: safe to re-run. It only adds or links things; anything it would
# replace is moved to a timestamped backup directory first, never deleted.
#
# --update also pulls this repo, then moves every user-scope plugin,
# marketplace and third-party skill to its latest upstream version.
#
# Usage: ./install.sh [--update] [--dry-run]

set -euo pipefail

# shellcheck source=lib.sh
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

BACKUP_DIR="$CLAUDE_DIR/backups/ai-setup-$(date +%Y%m%d-%H%M%S)"
DRY_RUN=0
UPDATE=0
# Set when install.sh re-runs itself after pulling a newer version.
PULLED=0
PLUGINS_CHANGED=0
ARGS=("$@")

usage() {
  sed -n '2,11p' "$0" | sed 's/^# \{0,1\}//'
}

for arg in "$@"; do
  case "$arg" in
    --dry-run) DRY_RUN=1 ;;
    --update) UPDATE=1 ;;
    --pulled) PULLED=1 ;;
    -h | --help) usage; exit 0 ;;
    *) echo "Unknown option: $arg" >&2; usage >&2; exit 1 ;;
  esac
done

run() {
  if ((DRY_RUN)); then
    printf '    [dry-run] %s\n' "$*"
  else
    "$@"
  fi
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

  if [[ ! -d "$dest/.git" ]]; then
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

# Pull this repo, then re-run the pulled install.sh so the rest of the run
# uses the new scripts and manifests.
self_update() {
  log "This repo ($REPO_DIR)"
  require git "repo update" || return 0

  if [[ -n "$(git -C "$REPO_DIR" status --porcelain)" ]]; then
    warn "uncommitted changes in $REPO_DIR, not pulling"
    return 0
  fi
  if ((DRY_RUN)); then
    run git -C "$REPO_DIR" pull --ff-only --quiet
    return 0
  fi

  local before
  before="$(git -C "$REPO_DIR" rev-parse HEAD)"
  if ! git -C "$REPO_DIR" pull --ff-only --quiet; then
    warn "could not fast-forward $REPO_DIR (diverged or offline), not pulling"
    return 0
  fi
  if [[ "$(git -C "$REPO_DIR" rev-parse HEAD)" == "$before" ]]; then
    info "already up to date"
    return 0
  fi
  info "pulled $(git -C "$REPO_DIR" rev-list --count "$before..HEAD") commit(s), restarting install.sh"
  exec "$REPO_DIR/install.sh" "${ARGS[@]}" --pulled
}

# "<id> <version>" for each user-scope plugin. Skills-dir entries are skills
# that Claude Code shows as plugins; they are updated with the skills.
user_plugin_versions() {
  claude plugin list --json | python3 -c '
import json, sys
for p in json.load(sys.stdin):
    if p["scope"] == "user" and not p["id"].endswith("@skills-dir"):
        print(p["id"], p.get("version", "?"))'
}

update_plugins() {
  log "Update plugins (all user scope)"
  require claude "plugin update" || return 0
  require python3 "plugin update" || return 0

  run claude plugin marketplace update

  local before after plugin _version
  before="$(user_plugin_versions)"
  # Read from fd 3: `claude plugin update` may prompt on stdin.
  while read -r -u 3 plugin _version; do
    [[ -n "$plugin" ]] || continue
    run claude plugin update --scope user "$plugin" || warn "could not update $plugin"
  done 3<<<"$before"
  after="$(user_plugin_versions)"

  if [[ "$before" != "$after" ]]; then
    PLUGINS_CHANGED=1
    diff <(echo "$before") <(echo "$after") | sed -n 's/^> /    updated /p' || true
  fi
}

update_skills() {
  log "Update third-party skills (all global)"
  if require npx "skills update"; then
    run npx -y skills update --global --yes || warn "npx skills update failed"
  fi

  require git "vendored skills update" || return 0
  local repo
  shopt -s nullglob
  for repo in "$VENDOR_DIR"/*/; do
    repo="${repo%/}"
    [[ -d "$repo/.git" ]] || continue
    if run git -C "$repo" pull --ff-only --quiet; then
      info "pulled $(basename "$repo")"
    else
      warn "could not fast-forward $repo"
    fi
  done
  shopt -u nullglob
}

main() {
  ((DRY_RUN)) && log "Dry run: nothing will be changed"
  ((UPDATE && !PULLED)) && self_update
  link_global
  merge_settings
  link_own_plugins
  install_plugins
  install_skills
  if ((UPDATE)); then
    update_plugins
    update_skills
  fi
  [[ -d "$BACKUP_DIR" ]] && log "Backups saved in $BACKUP_DIR"
  log "Done"
  ((PLUGINS_CHANGED)) && warn "plugins were updated: restart Claude Code to apply"
  return 0
}

main
