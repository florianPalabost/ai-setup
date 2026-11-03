# shellcheck shell=bash disable=SC2034  # variables are used by the sourcing scripts
# Shared by install.sh and snapshot.sh. Source it, don't run it.

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CLAUDE_DIR="${CLAUDE_CONFIG_DIR:-$HOME/.claude}"
VENDOR_DIR="${XDG_DATA_HOME:-$HOME/.local/share}/ai-setup/vendor"

log() { printf '\033[1;34m==>\033[0m %s\n' "$*"; }
info() { printf '    %s\n' "$*"; }
warn() { printf '\033[1;33m!!\033[0m  %s\n' "$*" >&2; }

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

# Paths, relative to the checkout $1, of the skills its
# .claude-plugin/plugin.json ships, one per line. Each "skills" entry is a skill
# dir, or a dir of skill dirs; without the key, every skills/<name>/.
plugin_skill_paths() {
  python3 - "$1" <<'PY'
import json, sys
from pathlib import Path

root = Path(sys.argv[1]).resolve()
entries = json.loads((root / ".claude-plugin" / "plugin.json").read_text()).get("skills", ["skills"])
for entry in [entries] if isinstance(entries, str) else entries:
    path = (root / entry).resolve()
    skills = [path] if (path / "SKILL.md").is_file() else sorted(p.parent for p in path.glob("*/SKILL.md"))
    for skill in skills:
        print(skill.relative_to(root))
PY
}
