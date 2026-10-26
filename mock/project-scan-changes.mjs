const MAX_CONTENT_RENAME_FILES = 300;
const MAX_CONTENT_RENAME_LINES = 200;

function comparableContent(file) {
  if (file.status !== 'read' || typeof file.content !== 'string' || file.content.length > 50000) return null;
  const lines = new Set(file.content.split(/\r?\n/).map(line => line.trim()).filter(line => line.length >= 8));
  return lines.size >= 8 && lines.size <= MAX_CONTENT_RENAME_LINES ? lines : null;
}

function extension(path) {
  const name = path.slice(path.lastIndexOf('/') + 1);
  const dot = name.lastIndexOf('.');
  return dot > 0 ? name.slice(dot).toLowerCase() : null;
}

function editedRenames(previous, current) {
  if (previous.size > MAX_CONTENT_RENAME_FILES || current.size > MAX_CONTENT_RENAME_FILES) return [];
  const old = [...previous.values()].map(file => ({ file, ext: extension(file.path), lines: comparableContent(file) })).filter(item => item.ext && item.lines);
  const fresh = [...current.values()].map(file => ({ file, ext: extension(file.path), lines: comparableContent(file) })).filter(item => item.ext && item.lines);
  const candidates = [];
  for (const before of old) for (const after of fresh) {
    if (before.ext !== after.ext || before.file.gitSha === after.file.gitSha) continue;
    const sizeRatio = Math.min(before.lines.size,after.lines.size) / Math.max(before.lines.size,after.lines.size);
    if (sizeRatio < 0.85) continue;
    const small = before.lines.size <= after.lines.size ? before.lines : after.lines;
    const large = small === before.lines ? after.lines : before.lines;
    let overlap = 0;
    for (const line of small) if (large.has(line)) overlap++;
    const score = overlap / Math.max(before.lines.size,after.lines.size);
    if (score >= 0.85) candidates.push({ before: before.file, after: after.file, score });
  }
  candidates.sort((a,b) => b.score - a.score || a.before.path.localeCompare(b.before.path) || a.after.path.localeCompare(b.after.path));
  const byOld = new Map(), byNew = new Map();
  for (const candidate of candidates) {
    const oldGroup = byOld.get(candidate.before.path) || [];
    if (oldGroup.length < 2) oldGroup.push(candidate);
    byOld.set(candidate.before.path,oldGroup);
    const newGroup = byNew.get(candidate.after.path) || [];
    if (newGroup.length < 2) newGroup.push(candidate);
    byNew.set(candidate.after.path,newGroup);
  }
  return candidates.filter(candidate => {
    const oldGroup = byOld.get(candidate.before.path), newGroup = byNew.get(candidate.after.path);
    return oldGroup[0] === candidate && newGroup[0] === candidate
      && (oldGroup.length === 1 || candidate.score - oldGroup[1].score >= 0.1)
      && (newGroup.length === 1 || candidate.score - newGroup[1].score >= 0.1);
  });
}

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
      current.delete(file.path);
      changes.push({ kind: 'renamed', path: file.path, oldPath: old.path, oldGitSha: old.gitSha, newGitSha: file.gitSha });
    }
  }
  for (const { before, after } of editedRenames(previous,current)) {
    if (!previous.has(before.path) || !current.has(after.path)) continue;
    previous.delete(before.path);
    current.delete(after.path);
    changes.push({ kind: 'renamed', path: after.path, oldPath: before.path, oldGitSha: before.gitSha, newGitSha: after.gitSha });
  }
  for (const file of current.values()) changes.push({ kind: 'added', path: file.path, oldPath: null, oldGitSha: null, newGitSha: file.gitSha });
  for (const file of previous.values()) changes.push({ kind: 'deleted', path: file.path, oldPath: null, oldGitSha: file.gitSha, newGitSha: null });
  return changes.sort((a,b) => a.path.localeCompare(b.path) || a.kind.localeCompare(b.kind));
}
