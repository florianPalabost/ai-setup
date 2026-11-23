# shellcheck shell=bash
# The herdr features install.sh offers, and the ones this machine wants. Sourced
# by install.sh after herdr.sh, whose HERDR_HOME it uses.

# "<id>|<label>|<mods in herdr/mods/>|<keys>[|off]", keys as "<key>=<command>"
# separated by spaces. "off": unticked until a choice is saved.
HERDR_FEATURES=(
  "git|Git panel: changes, PRs and the commit graph|git git-graph|"
  "factory|Factory panel: the factory's tickets, its board and its runs|factory-board orch-graph|"
  "find|Find panel: file names and text in files|find viewer|"
  "quick-open|Quick open (ctrl-p): a file by fuzzy name|quick-open viewer|ctrl-p=mod.open:quick-open"
  "search|Search (ctrl-alt-f): text in files|search viewer|ctrl-alt-f=mod.open:search"
  "bottom|Bottom panel (ctrl-j): Output follows a factory run or the Laravel log|bottom-output|ctrl-j=layout.toggle:bottom"
  "automations|Automations panel (ctrl-alt-a): scheduled agent prompts (installs a binary and a scheduler service)|automations|ctrl-alt-a=tabs-git.show-automations|off"
)
# The features whose panel is a node in the layout clone, with a button in the
# tab bar clone.
HERDR_PANEL_FEATURES=(git factory find bottom automations)
# One "<id> on|off" line per feature. A feature it doesn't list takes its default.
HERDR_CHOICE_FILE="$HERDR_HOME/.ai-setup-features"
HERDR_CHOICE_ON=on
HERDR_CHOICE_OFF=off
# The chosen feature ids, set by choose_herdr_features or load_herdr_choice.
HERDR_CHOSEN=()
HERDR_DEFAULT_OFF=off

# Field $2 (1: id, 2: label, 3: mods, 4: keys, 5: default) of the feature spec $1.
feature_field() {
  local id label mods keys default
  IFS='|' read -r id label mods keys default <<<"$1"
  case "$2" in
    1) printf '%s' "$id" ;;
    2) printf '%s' "$label" ;;
    3) printf '%s' "$mods" ;;
    4) printf '%s' "$keys" ;;
    5) printf '%s' "$default" ;;
  esac
}

# Whether the saved choice sets the feature $1 to $2 (on or off).
saved_as() {
  [[ -f "$HERDR_CHOICE_FILE" ]] && grep -qxF "$1 $2" "$HERDR_CHOICE_FILE"
}

# Whether the feature of spec $1 is on: as saved, else by default.
feature_on() {
  local id
  id="$(feature_field "$1" 1)"
  saved_as "$id" "$HERDR_CHOICE_ON" && return 0
  saved_as "$id" "$HERDR_CHOICE_OFF" && return 1
  [[ "$(feature_field "$1" 5)" != "$HERDR_DEFAULT_OFF" ]]
}

# Set HERDR_CHOSEN from the saved choice, the defaults for features it doesn't list.
load_herdr_choice() {
  local spec
  HERDR_CHOSEN=()
  for spec in "${HERDR_FEATURES[@]}"; do
    if feature_on "$spec"; then
      HERDR_CHOSEN+=("$(feature_field "$spec" 1)")
    fi
  done
}

herdr_chosen() {
  in_list "$1" ${HERDR_CHOSEN[@]+"${HERDR_CHOSEN[@]}"}
}

herdr_wants_panel() {
  local id
  for id in "${HERDR_PANEL_FEATURES[@]}"; do
    herdr_chosen "$id" && return 0
  done
  return 1
}

# The chosen panel features, space-separated: what the layout edit keeps.
herdr_chosen_panels() {
  local id out=()
  for id in "${HERDR_PANEL_FEATURES[@]}"; do
    herdr_chosen "$id" && out+=("$id")
  done
  printf '%s' "${out[*]+"${out[*]}"}"
}

# Print the mods, one per line without repeats, of the chosen features ($1 = wanted)
# or of every feature ($1 = all).
herdr_mods() {
  local spec mod
  for spec in "${HERDR_FEATURES[@]}"; do
    [[ "$1" == all ]] || herdr_chosen "$(feature_field "$spec" 1)" || continue
    for mod in $(feature_field "$spec" 3); do
      printf '%s\n' "$mod"
    done
  done | awk '!seen[$0]++'
}

# Print "<key> <command>" for each key of the chosen features ($1 = wanted) or of
# every feature ($1 = all).
herdr_keys() {
  local spec binding
  for spec in "${HERDR_FEATURES[@]}"; do
    [[ "$1" == all ]] || herdr_chosen "$(feature_field "$spec" 1)" || continue
    for binding in $(feature_field "$spec" 4); do
      printf '%s %s\n' "${binding%%=*}" "${binding#*=}"
    done
  done
}

save_herdr_choice() {
  local spec id
  ((DRY_RUN)) && return 0
  mkdir -p "$HERDR_HOME"
  for spec in "${HERDR_FEATURES[@]}"; do
    id="$(feature_field "$spec" 1)"
    if herdr_chosen "$id"; then
      printf '%s %s\n' "$id" "$HERDR_CHOICE_ON"
    else
      printf '%s %s\n' "$id" "$HERDR_CHOICE_OFF"
    fi
  done >"$HERDR_CHOICE_FILE"
}

# Flip the feature $1 in HERDR_CHOSEN.
toggle_herdr_feature() {
  local id kept=()
  if herdr_chosen "$1"; then
    for id in "${HERDR_CHOSEN[@]}"; do
      [[ "$id" == "$1" ]] || kept+=("$id")
    done
    HERDR_CHOSEN=("${kept[@]+"${kept[@]}"}")
  else
    HERDR_CHOSEN+=("$1")
  fi
}

print_herdr_checklist() {
  local spec index=1 mark
  for spec in "${HERDR_FEATURES[@]}"; do
    mark=" "
    herdr_chosen "$(feature_field "$spec" 1)" && mark="x"
    printf '    %d [%s] %s\n' "$index" "$mark" "$(feature_field "$spec" 2)"
    index=$((index + 1))
  done
}

# Ask which features to install, the saved choice ticked (the defaults the first
# time), and save the answer. A dry run or a run without a terminal takes the
# saved choice without asking.
choose_herdr_features() {
  local reply number
  load_herdr_choice
  if ((DRY_RUN)) || [[ ! -t 0 ]]; then
    info "features: ${HERDR_CHOSEN[*]:-none} (saved choice; run install in a terminal to change it)"
    return 0
  fi
  while true; do
    print_herdr_checklist
    read -r -p "    Numbers to tick or untick (e.g. 2 4), Enter to go on: " reply || reply=""
    [[ -n "$reply" ]] || break
    for number in $reply; do
      if [[ "$number" =~ ^[0-9]+$ ]] && ((number >= 1 && number <= ${#HERDR_FEATURES[@]})); then
        toggle_herdr_feature "$(feature_field "${HERDR_FEATURES[number - 1]}" 1)"
      else
        warn "no feature $number"
      fi
    done
  done
  save_herdr_choice
  info "features: ${HERDR_CHOSEN[*]:-none}"
}
