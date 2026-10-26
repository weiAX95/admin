const normalize = value => String(value || '').normalize('NFKC').toLocaleLowerCase().replace(/[\p{P}\p{S}\s]+/gu, '');

function bigrams(value) {
  const characters = [...normalize(value)];
  if (!characters.length) return [];
  if (characters.length === 1) return characters;
  return characters.slice(1).map((character, index) => characters[index] + character);
}

function dice(left, right) {
  const a = bigrams(left), b = bigrams(right);
  if (!a.length || !b.length) return 0;
  const counts = new Map();
  for (const item of a) counts.set(item, (counts.get(item) || 0) + 1);
  let overlap = 0;
  for (const item of b) {
    const remaining = counts.get(item) || 0;
    if (remaining) { overlap++; counts.set(item, remaining - 1); }
  }
  return 2 * overlap / (a.length + b.length);
}

export function relatedAcceptedSuggestions(suggestion, accepted, limit = 3) {
  const seenTasks = new Set();
  return accepted.map(item => {
    const sourceMatch = Boolean(suggestion.source?.path && item.source?.path
      && suggestion.source.repositoryId === item.source.repositoryId
      && suggestion.source.branch === item.source.branch
      && suggestion.source.commitSha === item.source.commitSha
      && suggestion.source.path === item.source.path
      && suggestion.source.line === item.source.line
      && suggestion.source.excerpt === item.source.excerpt);
    const exact = normalize(suggestion.topic) === normalize(item.topic) && normalize(suggestion.practice) === normalize(item.practice);
    return {
      taskId: item.taskId,
      title: item.title,
      exact,
      ...(sourceMatch && !exact ? { sourceMatch: true } : {}),
      similarity: Math.round((dice(suggestion.topic, item.topic) * 0.4 + dice(suggestion.practice, item.practice) * 0.6) * 100) / 100,
    };
  }).filter(item => item.sourceMatch || item.similarity >= 0.55)
    .sort((a, b) => Number(b.exact) - Number(a.exact) || Number(Boolean(b.sourceMatch)) - Number(Boolean(a.sourceMatch)) || b.similarity - a.similarity || a.taskId.localeCompare(b.taskId))
    .filter(item => {
      if (seenTasks.has(item.taskId)) return false;
      seenTasks.add(item.taskId);
      return true;
    })
    .slice(0, limit);
}
