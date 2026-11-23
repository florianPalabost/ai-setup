#!/usr/bin/env bash
# Claude Code's status line while the Usage meter is on. Claude Code hands its
# limits to nothing else, so this saves them for the meter, then prints the model
# and the context used.

CACHE_DIR="$HOME/.cache/claude-usage"
LIMITS="$CACHE_DIR/limits.json"
LOCK="$CACHE_DIR/limits.json.lock"
STALE_LOCK_MINUTES=1
SAME_WINDOW_SECS=60

input="$(cat)"

save_limits_further_on() {
  local old
  mkdir -p "$CACHE_DIR"
  find "$LOCK" -maxdepth 0 -mmin +"$STALE_LOCK_MINUTES" -exec rmdir {} + 2>/dev/null
  mkdir "$LOCK" 2>/dev/null || return 0
  trap 'rmdir "$LOCK" 2>/dev/null' EXIT
  trap 'exit 1' HUP INT TERM
  old="$(jq -c 'select(type == "object")' "$LIMITS" 2>/dev/null)"
  if printf '%s' "$input" | jq -ce --argjson old "${old:-null}" --argjson same "$SAME_WINDOW_SECS" '
    def further($new; $was):
      if ($was | type) != "object" or ($was.resets_at // 0) <= now then $new
      elif ($new | type) != "object" then $was
      elif ($new.resets_at // 0) > ($was.resets_at // 0) + $same then $new
      elif ($new.resets_at // 0) < ($was.resets_at // 0) - $same then $was
      elif ($new.used_percentage // 0) >= ($was.used_percentage // 0) then $new
      else $was end;
    .rate_limits
    | {five_hour: further(.five_hour; $old.five_hour), seven_day: further(.seven_day; $old.seven_day)}' \
    >"$LIMITS.$$" 2>/dev/null; then
    mv "$LIMITS.$$" "$LIMITS"
  else
    rm -f "$LIMITS.$$"
  fi
  rmdir "$LOCK" 2>/dev/null
  trap - EXIT HUP INT TERM
}

if printf '%s' "$input" | jq -e '.rate_limits | type == "object"' >/dev/null 2>&1; then
  save_limits_further_on
fi

printf '%s' "$input" | jq -r '
  [.model.display_name // empty,
   (.context_window.used_percentage // empty | "\(round)% context")]
  | join(" · ")'
