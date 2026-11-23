# shellcheck shell=bash

CLAUDE_USAGE_STATUSLINE="$HERDR_SRC/mods/claude-usage/statusline.sh"
# The status line the meter's replaced, put back when the feature is unticked.
CLAUDE_USAGE_KEPT_STATUSLINE="$HERDR_HOME/.ai-setup-statusline.json"
CLAUDE_USAGE_ON=on
CLAUDE_USAGE_OFF=off

# $1: on sets the meter's status line, keeping the one it replaces; off puts that one back.
swap_claude_statusline() {
  py3 - "$1" "$CLAUDE_DIR/settings.json" "$CLAUDE_USAGE_KEPT_STATUSLINE" "bash \"$CLAUDE_USAGE_STATUSLINE\"" "$BACKUP_DIR" "$DRY_RUN" <<'PY'
import json, shutil, sys
from pathlib import Path

mode, settings_path, kept_path, command, backup_dir, dry_run = sys.argv[1], Path(sys.argv[2]), Path(sys.argv[3]), sys.argv[4], Path(sys.argv[5]), sys.argv[6] == "1"
ours = {"type": "command", "command": command}
settings = json.loads(settings_path.read_text()) if settings_path.exists() else {}
current = settings.get("statusLine")

def write(settings):
    if settings_path.exists():
        backup_dir.mkdir(parents=True, exist_ok=True)
        if not (backup_dir / "settings.json").exists():
            shutil.copy2(settings_path, backup_dir / "settings.json")
    settings_path.parent.mkdir(parents=True, exist_ok=True)
    settings_path.write_text(json.dumps(settings, indent=2) + "\n")

if mode == "on":
    if current == ours:
        sys.exit(0)
    if dry_run:
        print(f"    [dry-run] would set the Usage meter's status line in {settings_path}")
        sys.exit(0)
    kept_path.parent.mkdir(parents=True, exist_ok=True)
    kept_path.write_text(json.dumps({"statusLine": current}) + "\n")
    settings["statusLine"] = ours
    write(settings)
    print(f"    set the Usage meter's status line in {settings_path}, keeping the last one in {kept_path}")
else:
    if not kept_path.exists():
        sys.exit(0)
    if dry_run:
        print(f"    [dry-run] would put back the status line kept in {kept_path}")
        sys.exit(0)
    if current == ours:
        kept = json.loads(kept_path.read_text()).get("statusLine")
        if kept is None:
            settings.pop("statusLine", None)
        else:
            settings["statusLine"] = kept
        write(settings)
        print(f"    put back the status line kept in {kept_path}")
    else:
        print(f"    the status line in {settings_path} changed since the Usage meter set it: left as it is")
    kept_path.unlink()
PY
}

sync_claude_usage() {
  if ! herdr_chosen usage; then
    swap_claude_statusline "$CLAUDE_USAGE_OFF"
    return 0
  fi
  require jq "Usage meter status line" || return 0
  swap_claude_statusline "$CLAUDE_USAGE_ON"
}
