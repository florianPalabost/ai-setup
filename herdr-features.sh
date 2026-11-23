# shellcheck shell=bash

HERDR_FEATURES=(
  "git|Git panel: changes, PRs and the commit graph|git git-graph|"
  "factory|Factory panel: the factory's tickets, its board and its runs|factory-board orch-graph|"
  "find|Find panel: file names and text in files|find viewer|"
  "quick-open|Quick open (ctrl-p): a file by fuzzy name|quick-open viewer|ctrl-p=mod.open:quick-open"
  "search|Search (ctrl-alt-f): text in files|search viewer|ctrl-alt-f=mod.open:search"
  "bottom|Bottom panel (ctrl-j): Output follows a factory run or the Laravel log|bottom-output|ctrl-j=layout.toggle:bottom"
  "chat|Chat: Pi, Claude Code and Codex as a GUI chat, and sub-agents you can open as one (installs herdr-chat)|||off"
  "automations|Automations panel (ctrl-alt-a): scheduled agent prompts (installs a binary and a scheduler service)|automations|ctrl-alt-a=tabs-git.show-automations|off"
)
HERDR_PANEL_FEATURES=(git factory find bottom automations)
HERDR_CHOICE_FILE="$HERDR_HOME/.ai-setup-features"
HERDR_CHOICE_ON=on
HERDR_CHOICE_OFF=off
HERDR_CHOSEN=()
HERDR_DEFAULT_OFF=off

feature_part() {
  local id label mods keys default
  IFS='|' read -r id label mods keys default <<<"$1"
  printf '%s' "${!2}"
}

feature_id() { feature_part "$1" id; }
feature_label() { feature_part "$1" label; }
feature_mods() { feature_part "$1" mods; }
feature_keys() { feature_part "$1" keys; }
feature_default() { feature_part "$1" default; }

saved_as() {
  [[ -f "$HERDR_CHOICE_FILE" ]] && grep -qxF "$1 $2" "$HERDR_CHOICE_FILE"
}

feature_on() {
  local id
  id="$(feature_id "$1")"
  saved_as "$id" "$HERDR_CHOICE_ON" && return 0
  saved_as "$id" "$HERDR_CHOICE_OFF" && return 1
  [[ "$(feature_default "$1")" != "$HERDR_DEFAULT_OFF" ]]
}

load_herdr_choice() {
  local spec
  HERDR_CHOSEN=()
  for spec in "${HERDR_FEATURES[@]}"; do
    if feature_on "$spec"; then
      HERDR_CHOSEN+=("$(feature_id "$spec")")
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

herdr_chosen_panels() {
  local id out=()
  for id in "${HERDR_PANEL_FEATURES[@]}"; do
    herdr_chosen "$id" && out+=("$id")
  done
  printf '%s' "${out[*]+"${out[*]}"}"
}

herdr_mods() {
  local spec mod
  for spec in "${HERDR_FEATURES[@]}"; do
    [[ "$1" == all ]] || herdr_chosen "$(feature_id "$spec")" || continue
    for mod in $(feature_mods "$spec"); do
      printf '%s\n' "$mod"
    done
  done | awk '!seen[$0]++'
}

herdr_keys() {
  local spec binding
  for spec in "${HERDR_FEATURES[@]}"; do
    [[ "$1" == all ]] || herdr_chosen "$(feature_id "$spec")" || continue
    for binding in $(feature_keys "$spec"); do
      printf '%s %s\n' "${binding%%=*}" "${binding#*=}"
    done
  done
}

save_herdr_choice() {
  local spec id
  ((DRY_RUN)) && return 0
  mkdir -p "$HERDR_HOME"
  for spec in "${HERDR_FEATURES[@]}"; do
    id="$(feature_id "$spec")"
    if herdr_chosen "$id"; then
      printf '%s %s\n' "$id" "$HERDR_CHOICE_ON"
    else
      printf '%s %s\n' "$id" "$HERDR_CHOICE_OFF"
    fi
  done >"$HERDR_CHOICE_FILE"
}

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
    herdr_chosen "$(feature_id "$spec")" && mark="x"
    printf '    %d [%s] %s\n' "$index" "$mark" "$(feature_label "$spec")"
    index=$((index + 1))
  done
}

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
        toggle_herdr_feature "$(feature_id "${HERDR_FEATURES[number - 1]}")"
      else
        warn "no feature $number"
      fi
    done
  done
  save_herdr_choice
  info "features: ${HERDR_CHOSEN[*]:-none}"
}
