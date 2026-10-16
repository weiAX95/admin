export function compareProjectScanFiles(previousFiles, currentFiles) {
  if (!previousFiles) return [];
  const previous = new Map(previousFiles.map(file => [file.path, file]));
  const current = new Map(currentFiles.map(file => [file.path, file]));
  const changes = [];
  for (const [path, file] of current) {
    const old = previous.get(path);
    if (!old) continue;
    previous.delete(path);
    current.delete(path);
    if (old.gitSha !== file.gitSha) changes.push({ kind: 'modified', path, oldPath: null, oldGitSha: old.gitSha, newGitSha: file.gitSha });
  }
  const removedBySha = new Map();
  for (const file of previous.values()) {
    const group = removedBySha.get(file.gitSha) || [];
    group.push(file);
    removedBySha.set(file.gitSha, group);
  }
  for (const group of removedBySha.values()) group.sort((a,b) => a.path.localeCompare(b.path));
  for (const file of [...current.values()].sort((a,b) => a.path.localeCompare(b.path))) {
    const old = removedBySha.get(file.gitSha)?.shift();
    if (old) {
      previous.delete(old.path);
      changes.push({ kind: 'renamed', path: file.path, oldPath: old.path, oldGitSha: old.gitSha, newGitSha: file.gitSha });
    } else changes.push({ kind: 'added', path: file.path, oldPath: null, oldGitSha: null, newGitSha: file.gitSha });
  }
  for (const file of previous.values()) changes.push({ kind: 'deleted', path: file.path, oldPath: null, oldGitSha: file.gitSha, newGitSha: null });
  return changes.sort((a,b) => a.path.localeCompare(b.path) || a.kind.localeCompare(b.kind));
}
