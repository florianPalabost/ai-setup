const LIMITS = [
  { key: "five_hour", label: "5h" },
  { key: "seven_day", label: "7d" },
];
const MID_FROM = 50;
const HIGH_FROM = 80;
const MINUTE = 60;
const HOUR = 3600;
const DAY = 86400;

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
export function meterParts(saved, now) {
  return LIMITS.filter(({ key }) => saved?.[key]).map(({ key, label }) => {
    const { used_percentage, resets_at } = saved[key];
    const left = (resets_at ?? 0) - now;
    const used = left > 0 ? Math.round(Math.min(100, Math.max(0, used_percentage ?? 0))) : 0;
    return { label, percent: `${used}%`, tone: tone(used), resets: left > 0 ? timeLeft(left) : null };
  });
}
