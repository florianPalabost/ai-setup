#!/usr/bin/env bash
# PROTOTYPE (issue #7): copy both prototype mods into the running herdr app.
# Herdr refuses imports outside a mod's folder (symlinks too), so shared/prs.js
# is copied into each. Remove with: rm -rf ~/.config/herdr-app/mods/proto-prs-{panel,popup}
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
mods="${HERDR_APP_HOME:-$HOME/.config/herdr-app}/mods"
for m in proto-prs-panel proto-prs-popup; do
  mkdir -p "$mods/$m"
  cp "$here/$m/main.js" "$here/$m/mod.json" "$here/shared/prs.js" "$mods/$m/"
  herdr-app check "$mods/$m"
done
