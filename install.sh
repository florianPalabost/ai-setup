#!/usr/bin/env bash
# Install this AI setup on the current machine.
#
# Idempotent: safe to re-run. It only adds or links things; anything it would
# replace is moved to a timestamped backup directory first, never deleted. The
# only exception is the skill mirrors it generates itself, kept in sync in place.
# Rules, plugins, skills and herdr mods that an earlier version of this repo
# installed but the current one dropped are listed, and removed only after you confirm.
#
# --update also pulls this repo, then moves every user-scope plugin,
# marketplace and third-party skill to its latest upstream version.
#
# Where there's a display, it also installs herdr and sets up its Git panel (see herdr.sh).
#
# Usage: ./install.sh [--update] [--dry-run]

set -euo pipefail

# shellcheck source=lib.sh
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"
# shellcheck source=herdr.sh
source "$(dirname "${BASH_SOURCE[0]}")/herdr.sh"

BACKUP_DIR="$CLAUDE_DIR/backups/ai-setup-$(date +%Y%m%d-%H%M%S)"
DRY_RUN=0
UPDATE=0
# Set when install.sh re-runs itself after pulling a newer version.
PULLED=0
PLUGINS_CHANGED=0
ARGS=("$@")

usage() {
  sed -n '2,15p' "$0" | sed 's/^# \{0,1\}//'
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

# Like run, writing the command's stdout to the file $1.
run_to() {
  local dst="$1"
  shift
  if ((DRY_RUN)); then
    printf '    [dry-run] %s > %s\n' "$*" "$dst"
  else
    "$@" >"$dst"
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

# Whether $2 already is what place_link makes for $1. A copy from its Windows
# fallback counts as long as it matches, so only a change gets a backup and a warning.
link_is_current() {
  local src="$1" dst="$2"
  if [[ -L "$dst" ]]; then
    [[ "$(readlink "$dst")" == "$src" ]]
  else
    is_windows && [[ -f "$src" && -f "$dst" ]] && cmp -s "$src" "$dst"
  fi
}

# Make $2 point at $1. Native Windows symlinks need Developer Mode or admin, and
# without nativestrict Git Bash's ln quietly copies, so refusal has to be asked
# for. Git Bash reports a junction as a symlink, so link_is_current sees it too.
place_link() {
  local src="$1" dst="$2"
  if ((DRY_RUN)) || ! is_windows; then
    run ln -s "$src" "$dst"
    return
  fi
  if MSYS=winsymlinks:nativestrict ln -s "$src" "$dst" 2>/dev/null; then
    return 0
  fi
  if [[ -d "$src" ]]; then
    cmd //c mklink //J "$(cygpath -w "$dst")" "$(cygpath -w "$src")" >/dev/null
  else
    cp "$src" "$dst" && warn "symlinks aren't permitted here, so $dst is a copy: re-run install to refresh it"
  fi
}

link() {
  local src="$1" dst="$2"
  if link_is_current "$src" "$dst"; then
    return 0
  fi
  backup "$dst"
  run mkdir -p "$(dirname "$dst")"
  if is_windows; then
    if ! place_link "$src" "$dst"; then
      warn "could not link $dst -> $src"
      return 0
    fi
  else
    place_link "$src" "$dst"
  fi
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
  require_python "settings merge" || return 0

  py3 - "$REPO_DIR/global/settings.json" "$CLAUDE_DIR/settings.json" "$BACKUP_DIR" "$DRY_RUN" <<'PY'
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
  require_python "plugins" || return 0

  local marketplaces installed
  marketplaces="$(claude plugin marketplace list --json | py3 -c 'import json,sys; print("\n".join(m["name"] for m in json.load(sys.stdin)))')"
  installed="$(claude plugin list --json | py3 -c 'import json,sys; print("\n".join(p["id"] for p in json.load(sys.stdin) if p["scope"] == "user"))')"

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

# Skill names a manifest git line may rename from or to. Being plain words,
# they need no escaping in the sed program rename_script builds.
SKILL_NAME_PATTERN='^[a-z0-9-]+$'

# Point the mirror entry $2 at $1.
mirror_link() {
  local src="$1" dst="$2"
  if link_is_current "$src" "$dst"; then
    return 0
  fi
  if [[ -e "$dst" || -L "$dst" ]]; then
    run rm "$dst"
  fi
  place_link "$src" "$dst"
}

# A vendored skill is linked through its skill mirror (see GLOSSARY.md) in
# $VENDOR_DIR/.mirrors/<name> when either:
# - its dir holds .claude-plugin/: Claude Code would also load it as a
#   "<name>@skills-dir" plugin, so its commands would show up twice (bare from
#   ~/.claude/commands, and as "<name>:<command>"). The mirror leaves it out.
# - a rename (see rename_script) changes its SKILL.md: the mirror holds the
#   rewritten copy.
# Every other entry is linked, and .source names the checkout dir for
# snapshot.sh. Synced on every run, changing only what differs. Prints the
# mirror path.
# $3: sed -E program from rename_script, possibly empty.
mirror_skill() {
  local src="$1" name="$2" sed_script="$3" mirror entry dst
  mirror="$VENDOR_DIR/.mirrors/$name"
  {
    [[ -d "$mirror" ]] || run mkdir -p "$mirror"
    shopt -s nullglob dotglob
    for entry in "$src"/*; do
      dst="$mirror/$(basename "$entry")"
      case "$(basename "$entry")" in
        .claude-plugin) ;;
        SKILL.md)
          if ! rewrites "$sed_script" "$entry"; then
            mirror_link "$entry" "$dst"
          elif [[ -L "$dst" ]] || ! sed -E "$sed_script" "$entry" | cmp -s - "$dst"; then
            [[ -L "$dst" ]] && run rm "$dst"
            run_to "$dst" sed -E "$sed_script" "$entry"
          fi
          ;;
        *) mirror_link "$entry" "$dst" ;;
      esac
    done
    # Entries upstream dropped
    for dst in "$mirror"/*; do
      if [[ "$(basename "$dst")" != ".source" && ! -e "$src/$(basename "$dst")" ]]; then
        run rm "$dst"
      fi
    done
    shopt -u nullglob dotglob
    if [[ "$(cat "$mirror/.source" 2>/dev/null)" != "$src" ]]; then
      run_to "$mirror/.source" printf '%s\n' "$src"
    fi
  } >&2
  printf '%s\n' "$mirror"
}

# Whether the sed -E program $1 (possibly empty) changes the file $2.
rewrites() {
  [[ -n "$1" ]] && ! sed -E "$1" "$2" | cmp -s - "$2"
}

# "<old> <new>" for each rename the manifest gives for the repo cloned from $1:
# the 4th field of its git lines, the <skill>=<name> fields of its
# plugin-skills line.
manifest_renames() {
  local url="$1" type source fields target name rename
  while read -r type source fields; do
    [[ "$source" == "$url" ]] || continue
    case "$type" in
      git)
        read -r target name <<<"$fields"
        if [[ -n "$name" ]]; then
          printf '%s %s\n' "$(basename "$target")" "$name"
        fi
        ;;
      plugin-skills)
        for rename in $fields; do
          printf '%s %s\n' "${rename%%=*}" "${rename#*=}"
        done
        ;;
    esac
  done < <(manifest_lines "$REPO_DIR/manifests/skills.txt")
}

# The name the manifest installs skill $2 of the repo cloned from $1 under.
renamed() {
  local old new
  while read -r old new; do
    if [[ "$old" == "$2" ]]; then
      printf '%s\n' "$new"
      return 0
    fi
  done < <(manifest_renames "$1")
  printf '%s\n' "$2"
}

# The sed -E program that applies the manifest's renames for the repo cloned
# from $1, wherever a skill name appears as a whole word. Each substitution runs
# twice: a match consumes the character after it, which can hide the next
# occurrence from the first pass.
rename_script() {
  local old new sub script=""
  while read -r old new; do
    if [[ "$old" == "$new" || ! "$old" =~ $SKILL_NAME_PATTERN || ! "$new" =~ $SKILL_NAME_PATTERN ]]; then
      continue # invalid names are warned about by install_git_skill
    fi
    sub="s/(^|[^a-z0-9-])$old([^a-z0-9-]|\$)/\1$new\2/g"
    script+="$sub;$sub;"
  done < <(manifest_renames "$1")
  printf '%s' "$script"
}

# Warn about the files of skill $2 (dir $1), other than SKILL.md, that mention
# a renamed skill: they are linked as is, so the old name stays in them.
warn_unrenamed() {
  local src="$1" name="$2" sed_script="$3" file
  while IFS= read -r -d '' file; do
    if [[ "$file" != "$src/SKILL.md" ]] && rewrites "$sed_script" "$file"; then
      warn "$name: ${file#"$src"/} mentions a renamed skill, which isn't rewritten there"
    fi
  done < <(find "$src" -type f -name '*.md' -print0)
}

# Remove the skill mirrors no skill links to any more (skill dropped or renamed).
prune_mirrors() {
  local mirror skill used
  shopt -s nullglob
  for mirror in "$VENDOR_DIR"/.mirrors/*; do
    used=0
    for skill in "$CLAUDE_DIR"/skills/*; do
      if [[ -L "$skill" && "$(readlink "$skill")" == "$mirror" ]]; then
        used=1
      fi
    done
    if ((!used)); then
      run rm -rf "$mirror"
      info "removed unused mirror $mirror"
    fi
  done
  shopt -u nullglob
}

# Clone $1 into the vendor dir unless it's there; prints the checkout dir.
vendor_checkout() {
  local dest
  dest="$VENDOR_DIR/$(basename "$1" .git)"
  if [[ ! -d "$dest/.git" ]]; then
    {
      run mkdir -p "$VENDOR_DIR"
      run git clone --depth 1 --quiet "$1" "$dest"
    } >&2
  fi
  printf '%s\n' "$dest"
}

# $1 clone url, $2 path in repo.
install_git_skill() {
  local url="$1" path="$2" name dest cmd sed_script
  name="$(renamed "$url" "$(basename "$path")")"
  if [[ ! "$name" =~ $SKILL_NAME_PATTERN || ! "$(basename "$path")" =~ $SKILL_NAME_PATTERN ]]; then
    warn "skipping $path: skill names must match $SKILL_NAME_PATTERN"
    return 0
  fi
  dest="$(vendor_checkout "$url")"
  # Only on a dry run, which clones nothing
  if [[ ! -d "$dest" ]]; then
    info "$name: not cloned yet, so its links can't be previewed"
    return 0
  fi

  sed_script="$(rename_script "$url")"
  if [[ -n "$sed_script" ]]; then
    warn_unrenamed "$dest/$path" "$name" "$sed_script"
  fi
  if [[ -d "$dest/$path/.claude-plugin" ]] || rewrites "$sed_script" "$dest/$path/SKILL.md"; then
    link "$(mirror_skill "$dest/$path" "$name" "$sed_script")" "$CLAUDE_DIR/skills/$name"
  else
    link "$dest/$path" "$CLAUDE_DIR/skills/$name"
  fi
  shopt -s nullglob
  for cmd in "$dest/$path"/commands/*.md; do
    link "$cmd" "$CLAUDE_DIR/commands/$(basename "$cmd")"
  done
  shopt -u nullglob
}

# Every skill the plugin in the repo cloned from $1 ships (see plugin_skill_paths).
install_plugin_skills() {
  local url="$1" dest path
  dest="$(vendor_checkout "$url")"
  # Only on a dry run, which clones nothing
  if [[ ! -d "$dest" ]]; then
    info "$url: not cloned yet, so its skills can't be previewed"
    return 0
  fi
  while read -r path; do
    install_git_skill "$url" "$path"
  done < <(plugin_skill_paths "$dest")
}

# $1: "vendored" to only handle the git and plugin-skills lines.
install_skills() {
  local only="${1:-}" type source target
  log "Third-party skills (manifests/skills.txt${only:+, $only only})"
  while read -r type source target _; do
    if [[ -n "$only" && "$type" == "skills" ]]; then
      continue
    fi
    case "$type" in
      skills)
        if [[ -e "$CLAUDE_DIR/skills/$target" ]]; then
          info "$target already installed"
        elif require npx "skill $target"; then
          run npx -y skills add "$source" --global --yes --agent claude-code --skill "$target"
        fi
        ;;
      git)
        # A rename in the 4th field is read by install_git_skill
        if require git "skill $source"; then
          install_git_skill "$source" "$target"
        fi
        ;;
      plugin-skills)
        if require git "skills of $source"; then
          install_plugin_skills "$source"
        fi
        ;;
      *) warn "unknown skill type '$type' in manifests/skills.txt" ;;
    esac
  done < <(manifest_lines "$REPO_DIR/manifests/skills.txt")
  prune_mirrors
}

# Print "<kind>\t<entry>" for each thing an earlier commit of this repo
# installed, the current one no longer lists, and is still on this machine:
#   rule:<allow|deny|ask>  permission rule in settings.json
#   plugin                 user-scope plugin from manifests/plugins.txt
#   skill                  skill from manifests/skills.txt
#   link                   symlink into this repo or the vendor dir whose target is gone
stale_entries() {
  py3 - "$REPO_DIR" "$CLAUDE_DIR" "$VENDOR_DIR" "$BASH" <<'PY'
import json, os, re, shutil, subprocess, sys
from pathlib import Path

# bash by path: on Windows the bare name finds WSL's launcher in System32 first.
repo, claude_dir, vendor_dir, bash = sys.argv[1], Path(sys.argv[2]), sys.argv[3], sys.argv[4]

def git(*args):
    return subprocess.run(["git", "-C", repo, *args], capture_output=True, text=True).stdout

def versions(path):
    """Contents of path at every commit that touched it, then the working tree."""
    shas = git("log", "--format=%H", "--", path).split()
    return [git("show", f"{sha}:{path}") for sha in shas], (Path(repo) / path).read_text()

def manifest_keys(text, keys_of):
    """Union of keys_of(fields), a set, over the manifest's entry lines."""
    keys = set()
    for line in text.splitlines():
        fields = re.sub(r"#.*", "", line).split()
        if fields:
            keys |= keys_of(fields)
    return keys

# Permission rules
settings = claude_dir / "settings.json"
local = json.loads(settings.read_text()).get("permissions", {}) if settings.exists() else {}
old, now = versions("global/settings.json")
current = json.loads(now).get("permissions", {})
stale = {}
for text in old:
    try:
        perms = json.loads(text).get("permissions", {})
    except ValueError:
        continue
    for kind, rules in perms.items():
        if not isinstance(rules, list):
            continue
        for rule in rules:
            if rule not in current.get(kind, []) and rule in local.get(kind, []):
                stale.setdefault(f"rule:{kind}", {})[rule] = None
for kind, rules in stale.items():
    for rule in rules:
        print(f"{kind}\t{rule}")

# Plugins
installed = set()
# By full path: on Windows the bare name doesn't find an npm install's claude.cmd.
claude = shutil.which("claude")
if claude:
    out = subprocess.run([claude, "plugin", "list", "--json"], capture_output=True, text=True).stdout
    installed = {p["id"] for p in json.loads(out or "[]") if p["scope"] == "user"}
old, now = versions("manifests/plugins.txt")
first = lambda f: {f[0]}
gone = set().union(*(manifest_keys(t, first) for t in old)) - manifest_keys(now, first)
for plugin in sorted(gone & installed):
    print(f"plugin\t{plugin}")

# Skills, by installed name
def plugin_skill_names(url, renames):
    """Names a plugin-skills line installs, from the checkout's current plugin.json."""
    checkout = Path(vendor_dir) / os.path.basename(url).removesuffix(".git")
    if not (checkout / ".claude-plugin" / "plugin.json").is_file():
        return set()
    paths = subprocess.run(
        [bash, "-c", 'source "$1/lib.sh" && plugin_skill_paths "$2"', "_", repo, str(checkout)],
        capture_output=True, text=True,
    ).stdout.split()
    renamed = dict(rename.split("=", 1) for rename in renames)
    return {renamed.get(name, name) for name in map(os.path.basename, paths)}

def skill_names(fields):
    kind, source, *rest = fields
    if kind == "skills":
        return {rest[0]}
    if kind == "git":
        return {rest[1] if len(rest) > 1 else os.path.basename(rest[0].rstrip("/"))}
    if kind == "plugin-skills":
        return plugin_skill_names(source, rest)
    return set()

old, now = versions("manifests/skills.txt")
gone = set().union(*(manifest_keys(t, skill_names) for t in old)) - manifest_keys(now, skill_names)
for skill in sorted(gone):
    path = claude_dir / "skills" / skill
    if path.exists() or path.is_symlink():
        print(f"skill\t{path}")

# Dangling links left by renamed or removed repo/vendor items
for sub in ("skills", "commands", "agents"):
    for path in sorted((claude_dir / sub).glob("*")):
        if path.is_symlink() and not path.exists():
            target = os.readlink(path)
            if target.startswith((repo + "/", vendor_dir + "/")):
                print(f"link\t{path}")
PY
}

# $1: "rule:<kind>\t<rule>" lines from stale_entries.
remove_rules() {
  py3 - "$CLAUDE_DIR/settings.json" "$BACKUP_DIR" "$1" <<'PY'
import json, shutil, sys
from pathlib import Path

dst, backup_dir, entries = Path(sys.argv[1]), Path(sys.argv[2]), sys.argv[3]
settings = json.loads(dst.read_text())
perms = settings.get("permissions", {})
for line in entries.splitlines():
    kind, rule = line.split("\t", 1)
    kind = kind.removeprefix("rule:")
    if rule in perms.get(kind, []):
        perms[kind].remove(rule)
backup_dir.mkdir(parents=True, exist_ok=True)
if not (backup_dir / "settings.json").exists():
    shutil.copy2(dst, backup_dir / "settings.json")
dst.write_text(json.dumps(settings, indent=2) + "\n")
PY
}

# The stale_entries lines $1, with their file paths in this shell's form: Python
# on Windows prints C:\ paths, and everything here compares and moves /c/ ones.
posix_entries() {
  local kind entry
  if ! is_windows; then
    printf '%s\n' "$1"
    return 0
  fi
  while IFS=$'\t' read -r kind entry; do
    case "$kind" in
      skill | link | herdr-mod | herdr-layout) entry="$(cygpath -u "$entry")" ;;
    esac
    printf '%s\t%s\n' "$kind" "$entry"
  done <<<"$1"
}

# install.sh only adds, so whatever the repo stops listing stays behind.
# List it, then remove it only if the user says yes.
prune_stale() {
  log "Leftovers from earlier versions of this repo"
  require_python "leftover check" || return 0
  require git "leftover check" || return 0

  local entries
  entries="$(stale_entries && herdr_stale_entries)"
  if [[ -z "$entries" ]]; then
    info "none"
    return 0
  fi
  entries="$(posix_entries "$entries")"
  while IFS=$'\t' read -r kind entry; do
    info "$kind  $entry"
  done <<<"$entries"

  if ((DRY_RUN)); then
    info "[dry-run] would ask to remove these"
    local showing
    showing="$(herdr_dropped_layout_showing "$entries")"
    if [[ -n "$showing" ]]; then
      info "[dry-run] $showing is showing: herdr would leave it before it is removed"
    fi
    return 0
  fi
  if [[ ! -t 0 ]]; then
    info "not a terminal, keeping them (re-run interactively to remove)"
    return 0
  fi
  local reply
  read -r -p "    Remove these? Skills, links and herdr files are moved to the backup dir. [y/N] " reply
  if [[ "$reply" != [yY]* ]]; then
    info "kept"
    return 0
  fi

  if ! herdr_leave_dropped_layout "$entries"; then
    entries="$(grep -v '^herdr-' <<<"$entries" || true)"
  fi

  local rules
  rules="$(grep '^rule:' <<<"$entries" || true)"
  [[ -n "$rules" ]] && remove_rules "$rules" && info "removed rules from $CLAUDE_DIR/settings.json"
  while IFS=$'\t' read -r kind entry; do
    case "$kind" in
      plugin)
        claude plugin uninstall --scope user "$entry" && PLUGINS_CHANGED=1 && info "uninstalled $entry"
        ;;
      skill | link | herdr-mod | herdr-layout) backup "$entry" ;;
    esac
  done <<<"$entries"
  # Mirrors of the skills just removed
  prune_mirrors
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
  claude plugin list --json | py3 -c '
import json, sys
for p in json.load(sys.stdin):
    if p["scope"] == "user" and not p["id"].endswith("@skills-dir"):
        print(p["id"], p.get("version", "?"))'
}

update_plugins() {
  log "Update plugins (all user scope)"
  require claude "plugin update" || return 0
  require_python "plugin update" || return 0

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
  install_herdr
  prune_stale
  if ((UPDATE)); then
    update_plugins
    update_skills
    # Sync mirrors with the pulled checkouts (new entries, rewritten copies)
    install_skills vendored
  fi
  [[ -d "$BACKUP_DIR" ]] && log "Backups saved in $BACKUP_DIR"
  log "Done"
  ((PLUGINS_CHANGED)) && warn "plugins were updated: restart Claude Code to apply"
  remind_gh_sign_in
  return 0
}

# Sourced by the tests, to call one step on its own.
if [[ "${BASH_SOURCE[0]}" == "$0" ]]; then
  main
fi
