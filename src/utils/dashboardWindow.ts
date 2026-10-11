import type { TimeWindow } from "../types";

const DAY_MS = 86400000;

function shanghaiToday(now: Date): string {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(now);
  const part = (type: string) => parts.find(item => item.type === type)!.value;
  return `${part("year")}-${part("month")}-${part("day")}`;
}

function dateValue(key: string): number {
  return Date.parse(`${key}T00:00:00Z`);
}

function shiftDay(key: string, days: number): string {
  return new Date(dateValue(key) + days * DAY_MS).toISOString().slice(0, 10);
}

export function resolveDashboardWindow(preset: TimeWindow, custom: [string, string] | null, now = new Date()): { start: string; end: string } | null {
  const end = shanghaiToday(now);
  if (preset === "custom") {
    if (!custom) return null;
    const [start, customEnd] = custom;
    const span = dateValue(customEnd) - dateValue(start);
    return Number.isFinite(span) && span >= 0 && span <= 365 * DAY_MS ? { start, end: customEnd } : null;
  }
  if (preset === "today") return { start: end, end };
  if (preset === "week") {
    const weekday = new Date(dateValue(end)).getUTCDay();
    return { start: shiftDay(end, -((weekday + 6) % 7)), end };
  }
  if (preset === "month") return { start: `${end.slice(0, 7)}-01`, end };
  const days = preset === "30d" ? 29 : preset === "90d" ? 89 : 364;
  return { start: shiftDay(end, -days), end };
}
