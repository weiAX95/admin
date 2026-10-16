type Suggestion = { id: string; topic: string; impact: 'high' | 'medium' | 'low' | null; prerequisites: string[] };

const normalize = (value: string) => value.normalize('NFKC').toLocaleLowerCase().replace(/[\p{P}\p{S}\s]+/gu, '');
const impactRank = { high: 0, medium: 1, low: 2 };

export function orderProjectSuggestions<T extends Suggestion>(suggestions: T[]) {
  const topics = new Map<string, number[]>();
  suggestions.forEach((item, index) => {
    const key = normalize(item.topic);
    if (key) topics.set(key, [...(topics.get(key) || []), index]);
  });
  const dependencies = new Map<string, T[]>();
  const followers = suggestions.map(() => new Set<number>());
  const pending = suggestions.map(() => 0);
  suggestions.forEach((item, index) => {
    const matched = new Set<number>();
    for (const prerequisite of item.prerequisites) {
      const candidates = topics.get(normalize(prerequisite));
      if (candidates?.length === 1 && candidates[0] !== index) matched.add(candidates[0]);
    }
    dependencies.set(item.id, [...matched].map(position => suggestions[position]));
    pending[index] = matched.size;
    for (const position of matched) followers[position].add(index);
  });
  const ready = suggestions.map((_, index) => index).filter(index => !pending[index]);
  const ordered: number[] = [];
  const compare = (left: number, right: number) => (impactRank[suggestions[left].impact || 'low'] - impactRank[suggestions[right].impact || 'low']) || left - right;
  while (ready.length) {
    ready.sort(compare);
    const index = ready.shift()!;
    ordered.push(index);
    for (const follower of followers[index]) if (--pending[follower] === 0) ready.push(follower);
  }
  const hasCycle = ordered.length !== suggestions.length;
  const remaining = suggestions.map((_, index) => index).filter(index => pending[index]).sort(compare);
  return { items: [...ordered, ...remaining].map(index => suggestions[index]), dependencies, hasCycle };
}
