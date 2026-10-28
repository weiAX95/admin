import crypto from 'node:crypto';

// A review aid for findings without a requirements baseline. File moves and
// renamed titles intentionally produce a new key and require human matching.
export function projectFindingKey(finding) {
  if (finding.requirementId) return null;
  const name = finding.title.normalize('NFKC').trim().replace(/\s+/g,' ').toLocaleLowerCase();
  const identity = JSON.stringify([finding.moduleKey || '.',name,finding.evidence?.path || null]);
  return `F-${crypto.createHash('sha256').update(identity).digest('hex').slice(0,16)}`;
}
