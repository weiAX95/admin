const kinds = ['tasks', 'sessions', 'notes'];
const recentTitle = session => (session.messages?.find(message => message.role === 'user')?.content || '（无标题）').slice(0, 40);

export function quickActionCounts(db) {
  return Object.fromEntries(kinds.map(kind => [kind, db[kind].length]));
}

export function quickPreview(db, kind) {
  if (!kinds.includes(kind)) throw new Error('无效的预览类型');
  const items = [...db[kind]]
    .sort((a, b) => (b[kind === 'tasks' ? 'createdAt' : 'updatedAt'] || '').localeCompare(a[kind === 'tasks' ? 'createdAt' : 'updatedAt'] || ''))
    .slice(0, 3)
    .map(item => ({ id: item.id, title: kind === 'sessions' ? recentTitle(item) : item.title }));
  return { items };
}
