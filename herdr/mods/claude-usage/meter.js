const LIMITS = [
  { key: "five_hour", label: "5h", name: "5-hour" },
  { key: "seven_day", label: "7d", name: "Weekly" },
];
const MID_FROM = 50;
const HIGH_FROM = 80;
const MINUTE = 60;
const HOUR = 3600;
const DAY = 86400;

export const SHOW_USED = "used";
export const SHOW_LEFT = "left";

function timeLeft(seconds) {
  if (seconds < HOUR) return `${Math.max(1, Math.floor(seconds / MINUTE))}m`;
  if (seconds < DAY) return `${Math.floor(seconds / HOUR)}h ${Math.floor((seconds % HOUR) / MINUTE)}m`;
  return `${Math.floor(seconds / DAY)}d ${Math.floor((seconds % DAY) / HOUR)}h`;
}

function tone(used) {
  if (used >= HIGH_FROM) return "high";
  if (used >= MID_FROM) return "mid";
  return "low";
}

// saved: the cache the status line writes, { five_hour, seven_day: { used_percentage, resets_at } }.
function limits(saved, now) {
  return LIMITS.filter(({ key }) => saved?.[key]).map(({ key, label, name }) => {
    const { used_percentage, resets_at } = saved[key];
    const left = (resets_at ?? 0) - now;
    const used = left > 0 ? Math.round(Math.min(100, Math.max(0, used_percentage ?? 0))) : 0;
    return { label, name, used, resets: left > 0 ? timeLeft(left) : null };
  });
}

export function meterParts(saved, now) {
  return limits(saved, now).map(({ label, used, resets }) => ({ label, percent: `${used}%`, tone: tone(used), resets }));
}

// show: SHOW_USED or SHOW_LEFT, what the bars fill with. The tone always follows the used share.
export function limitBars(saved, now, show) {
  return limits(saved, now).map(({ name, used, resets }) => {
    const shown = show === SHOW_LEFT ? 100 - used : used;
    return { name, value: `${shown}% ${show}`, fill: shown / 100, tone: tone(used), resets: resets && `Resets in ${resets}` };
  });
}
