import type { CategoryStat, TaskStatus } from "../types";

export interface CategoryProgress {
  category: string;
  total: number;
  counts: Record<TaskStatus, number>;
}

export function aggregateCategoryProgress(categories: CategoryStat[], phase = ""): CategoryProgress[] {
  return categories.flatMap(category => {
    const tasks = category.tasks.filter(task => !phase || task.phase === phase);
    if (!tasks.length) return [];
    const counts: Record<TaskStatus, number> = { done: 0, in_progress: 0, todo: 0, blocked: 0 };
    for (const task of tasks) counts[task.status]++;
    return [{ category: category.category, total: tasks.length, counts }];
  });
}

export function categorySegmentPercent(count: number, total: number): number {
  return total ? Math.round(count / total * 1000) / 10 : 0;
}
