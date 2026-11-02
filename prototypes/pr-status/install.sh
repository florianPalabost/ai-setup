#!/bin/sh
# PROTOTYPE: copy the two proto mods into herdr-app, each with its own copy of pr-data.js.
# Remove with: rm -rf ~/.config/herdr-app/mods/proto-pr-strip ~/.config/herdr-app/mods/proto-pr-pane
set -eu
here=$(cd "$(dirname "$0")" && pwd)
mods="${HERDR_APP_HOME:-$HOME/.config/herdr-app}/mods"
for m in proto-pr-strip proto-pr-pane; do
  mkdir -p "$mods/$m"
  cp "$here/$m/main.js" "$here/$m/mod.json" "$mods/$m/"
  cp "$here/pr-data.js" "$mods/$m/pr-data.js"
  herdr-app check "$mods/$m"
done
