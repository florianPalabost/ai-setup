#!/usr/bin/env bash
# Record the third-party plugins and skills installed on this machine into
# manifests/plugins.txt and manifests/skills.txt.
#
# Only user-scope tooling is recorded, and anything listed in
# manifests/ignore.txt is left out. It only writes the manifests: review the
# result with `git diff` and commit it yourself.
#
# Usage: ./snapshot.sh

set -euo pipefail

# shellcheck source=lib.sh
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

SKILL_LOCK="$HOME/.agents/.skill-lock.json"

usage() {
  sed -n '2,9p' "$0" | sed 's/^# \{0,1\}//'
}

for arg in "$@"; do
  case "$arg" in
    -h | --help) usage; exit 0 ;;
    *) echo "Unknown option: $arg" >&2; usage >&2; exit 1 ;;
  esac
done

require claude "snapshot" || exit 1
require python3 "snapshot" || exit 1

log "Snapshot ($CLAUDE_DIR -> manifests/)"

# Vendored git skills: "<installed name> <clone url> <path in repo>", one per line.
vendored_skills() {
  local skill target repo
  shopt -s nullglob
  for skill in "$CLAUDE_DIR"/skills/*; do
    [[ -L "$skill" ]] || continue
    target="$(readlink -f "$skill")"
    # A skill mirror (see install.sh) names the checkout dir it stands for
    if [[ -f "$target/.source" ]]; then
      target="$(<"$target/.source")"
    fi
    [[ "$target" == "$VENDOR_DIR"/* ]] || continue
    repo="$VENDOR_DIR/$(cut -d/ -f1 <<<"${target#"$VENDOR_DIR"/}")"
    printf '%s %s %s\n' "$(basename "$skill")" \
      "$(git -C "$repo" remote get-url origin)" "${target#"$repo"/}"
  done
  shopt -u nullglob
}

python3 - "$REPO_DIR" "$CLAUDE_DIR" "$SKILL_LOCK" <(claude plugin list --json) <(vendored_skills) <(manifest_lines "$REPO_DIR/manifests/ignore.txt") <<'PY'
import json, os, sys
from pathlib import Path

repo_dir, claude_dir, skill_lock = Path(sys.argv[1]), Path(sys.argv[2]), Path(sys.argv[3])
installed_plugins = json.loads(Path(sys.argv[4]).read_text())
vendored = [line.split() for line in Path(sys.argv[5]).read_text().splitlines() if line.strip()]
ignored = {line.strip() for line in Path(sys.argv[6]).read_text().splitlines() if line.strip()}

def warn(msg):
    print(f"\033[1;33m!!\033[0m  {msg}", file=sys.stderr)

def columns(rows):
    widths = [max(len(row[i]) for row in rows if len(row) > i) for i in range(max(map(len, rows)))]
    return [" ".join(cell.ljust(widths[i] + 1) for i, cell in enumerate(row)).rstrip() for row in rows]

def write_manifest(path, *groups):
    old = path.read_text().splitlines() if path.exists() else []
    header = []
    for line in old:
        if line and not line.startswith("#"):
            break
        header.append(line)
    while header and not header[-1]:
        header.pop()

    blocks = [columns(rows) for rows in groups if rows]
    entries = [line for block in blocks for line in block]
    body = "\n\n".join("\n".join(block) for block in blocks)
    path.write_text("\n".join(header) + "\n\n" + body + "\n")

    def keys(lines):
        return {" ".join(line.split("#")[0].split()) for line in lines if line and not line.startswith("#")}
    for key in sorted(keys(entries) - keys(old)):
        print(f"    + {path.name}: {key}")
    for key in sorted(keys(old) - keys(entries)):
        print(f"    - {path.name}: {key}")

# Plugins: user scope only. Skills-dir entries are skills, recorded below.
marketplaces = json.loads((claude_dir / "plugins" / "known_marketplaces.json").read_text())
plugin_rows = []
for plugin in installed_plugins:
    pid = plugin["id"]
    if plugin["scope"] != "user" or pid.endswith("@skills-dir") or pid in ignored:
        continue
    source = marketplaces.get(pid.split("@", 1)[1], {}).get("source", {})
    if source.get("source") != "github":
        warn(f"{pid}: marketplace is not on GitHub, not recorded")
        continue
    plugin_rows.append([pid, source["repo"]] + ([] if plugin["enabled"] else ["disabled"]))
plugin_rows.sort()

# Skills: `npx skills` ones from its lock file, then vendored git checkouts.
lock = json.loads(skill_lock.read_text())["skills"] if skill_lock.exists() else {}
npx_rows = sorted(
    ["skills", entry["source"], name]
    for name, entry in lock.items()
    if name not in ignored and entry.get("sourceType") == "github"
)
# A 4th field records a skill installed under another name (see install.sh)
git_rows = sorted(
    ["git", url, path] + ([name] if name != os.path.basename(path) else [])
    for name, url, path in vendored
    if name not in ignored
)

# Anything else in the skills dir has a source we can't tell.
known = set(lock) | {name for name, _, _ in vendored} | ignored
for skill in sorted((claude_dir / "skills").iterdir()):
    if skill.name in known or skill.name.startswith("."):
        continue
    if skill.is_symlink() and Path(os.path.realpath(skill)).is_relative_to(repo_dir):
        continue  # own skill, already in this repo
    warn(f"skills/{skill.name}: unknown source, not recorded (add it to manifests/ignore.txt to silence)")

write_manifest(repo_dir / "manifests" / "plugins.txt", plugin_rows)
write_manifest(repo_dir / "manifests" / "skills.txt", npx_rows, git_rows)
PY

log "Done: review with 'git diff manifests/', then update the README tables"
