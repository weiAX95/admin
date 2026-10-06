import type { TaskTrendPoint } from "../types";

export type TrendGranularity = "day" | "week" | "month";
export interface TrendBucket extends TaskTrendPoint { end: string }

export function aggregateTaskTrends(points: TaskTrendPoint[], granularity: TrendGranularity): TrendBucket[] {
  const buckets = new Map<string, TrendBucket>();
  for (const point of [...points].sort((a, b) => a.date.localeCompare(b.date))) {
    let key = point.date;
    if (granularity === "month") key = point.date.slice(0, 7);
    if (granularity === "week") {
      const date = new Date(`${point.date}T00:00:00Z`);
      date.setUTCDate(date.getUTCDate() - (date.getUTCDay() + 6) % 7);
      key = date.toISOString().slice(0, 10);
    }
    const bucket = buckets.get(key);
    if (bucket) {
      bucket.created += point.created;
      bucket.completed += point.completed;
      bucket.avgProgress = point.avgProgress;
      bucket.end = point.date;
    } else buckets.set(key, { ...point, end: point.date });
  }
  return [...buckets.values()];
}
