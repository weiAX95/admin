const sqlPath = /\.sql$/i;
const codePath = /\.(?:[cm]?[jt]sx?|py|go)$/i;
const declaration = /\b(?:CREATE\s+TABLE(?:\s+IF\s+NOT\s+EXISTS)?|ALTER\s+TABLE(?:\s+IF\s+EXISTS)?|DROP\s+TABLE(?:\s+IF\s+EXISTS)?)\s+((?:"[A-Za-z_][A-Za-z0-9_]*"|[A-Za-z_][A-Za-z0-9_]*)(?:\.(?:"[A-Za-z_][A-Za-z0-9_]*"|[A-Za-z_][A-Za-z0-9_]*))?)/gi;
const reference = /\b(?:FROM|JOIN|UPDATE|INTO|REFERENCES)\s+((?:"[A-Za-z_][A-Za-z0-9_]*"|[A-Za-z_][A-Za-z0-9_]*)(?:\.(?:"[A-Za-z_][A-Za-z0-9_]*"|[A-Za-z_][A-Za-z0-9_]*))?)/gi;
const tableName = value => value.split('.').at(-1).replaceAll('"','').toLowerCase();

function names(content, pattern) {
  const result = new Set();
  pattern.lastIndex = 0;
  let match, count = 0;
  while ((match = pattern.exec(content)) && count++ < 1000) result.add(tableName(match[1]));
  return result;
}

export function projectSqlDependencyEdges(files) {
  const definitions = new Map();
  for (const file of files) {
    if (file.status !== 'read' || !sqlPath.test(file.path) || typeof file.content !== 'string' || file.content.length > 250000) continue;
    for (const name of names(file.content,declaration)) {
      if (!definitions.has(name)) definitions.set(name,new Set());
      definitions.get(name).add(file.path);
    }
  }
  const edges = new Map();
  for (const file of files) {
    if (file.status !== 'read' || !codePath.test(file.path) || typeof file.content !== 'string' || file.content.length > 250000) continue;
    const targets = new Set();
    for (const name of names(file.content,reference)) for (const path of definitions.get(name) || []) targets.add(path);
    if (targets.size) edges.set(file.path,targets);
  }
  return edges;
}

export function changedSqlNeedsBroadReview(changes, files) {
  const current = new Map(files.map(file => [file.path,file]));
  return changes.some(change => {
    if (!sqlPath.test(change.path) && !(change.oldPath && sqlPath.test(change.oldPath))) return false;
    const file = current.get(change.path);
    // A modified migration may have removed or renamed its former table, and a
    // deleted migration has no current text. In either case the current-only
    // graph cannot reconstruct the old edges, so invalidate every module.
    return change.kind !== 'added' || !file || file.status !== 'read' || typeof file.content !== 'string' || file.content.length > 250000 || !names(file.content,declaration).size;
  });
}
