const key = value => value.trim().replace(/\s+/g, ' ').toLocaleLowerCase();
const evidenceChanged = (left, right) => {
  if (!left || !right) return Boolean(left) !== Boolean(right);
  return ['type', 'path', 'line', 'excerpt', 'gitSha'].some(field => left[field] !== right[field]);
};

export function compareProjectReports(older, newer) {
  const limitations = [];
  const sameRepositoryIdentity = Boolean(older.githubRepositoryId && newer.githubRepositoryId
    && older.githubRepositoryId === newer.githubRepositoryId);
  if (!sameRepositoryIdentity) limitations.push('仓库身份不同或旧扫描缺少可信仓库身份');
  if (older.branch !== newer.branch) limitations.push('分支不同');
  if (!older.baselineVersionId || older.baselineVersionId !== newer.baselineVersionId) limitations.push('需求基线版本不同或缺失');
  if (older.goal !== newer.goal) limitations.push('项目目标不同');
  if (!older.analysisCoverageComplete || !newer.analysisCoverageComplete) limitations.push('至少一份报告只覆盖部分扫描内容');
  if (older.selectedFileCount !== newer.selectedFileCount || older.availableFileCount !== newer.availableFileCount) limitations.push('进入分析的文件数量或可用文件数量不同');

  const changes = [];
  const findingReview = { sameStatusChanges: [], unmatchedGroups: [] };
  const canPairRequirements = sameRepositoryIdentity && older.baselineVersionId
    && older.baselineVersionId === newer.baselineVersionId && older.branch === newer.branch && older.goal === newer.goal;
  if (canPairRequirements) {
    const group = report => {
      const result = new Map();
      for (const finding of report.findings) {
        if (!finding.requirementId) continue;
        const rows = result.get(finding.requirementId) || [];
        rows.push(finding);
        result.set(finding.requirementId, rows);
      }
      return result;
    };
    const before = group(older), after = group(newer);
    const missingBefore = older.findings.filter(finding => !finding.requirementId);
    const missingAfter = newer.findings.filter(finding => !finding.requirementId);
    if (missingBefore.length || missingAfter.length) findingReview.unmatchedGroups.push({
      reason: 'missing_requirement_id', requirementId: null, before: missingBefore, after: missingAfter,
    });
    for (const requirementId of new Set([...before.keys(), ...after.keys()])) {
      const oldFindings = before.get(requirementId) || [], newFindings = after.get(requirementId) || [];
      if (!oldFindings.length || !newFindings.length || oldFindings.length !== 1 || newFindings.length !== 1) {
        findingReview.unmatchedGroups.push({
          reason: !oldFindings.length ? 'new_only' : !newFindings.length ? 'old_only' : 'ambiguous_multiple',
          requirementId, before: oldFindings, after: newFindings,
        });
        continue;
      }
      const previous = oldFindings[0], current = newFindings[0];
      if (previous.status === current.status) {
        const changedFields = [
          previous.title !== current.title && 'title',
          previous.detail !== current.detail && 'detail',
          evidenceChanged(previous.evidence, current.evidence) && 'evidence',
        ].filter(Boolean);
        if (changedFields.length) findingReview.sameStatusChanges.push({ requirementId, changedFields, before: previous, after: current });
        continue;
      }
      const kind = current.status === 'implemented' ? 'completion_signal'
        : previous.status === 'implemented' ? 'possible_regression'
          : current.status === 'not_found' ? 'new_gap'
            : previous.status === 'not_found' ? 'improved_gap' : 'changed';
      changes.push({ requirementId, kind, before: previous, after: current });
    }
  } else if (older.findings.length || newer.findings.length) {
    findingReview.unmatchedGroups.push({
      reason: 'incomparable_scope', requirementId: null, before: older.findings, after: newer.findings,
    });
  }

  const oldSuggestions = new Map(older.suggestions.map(item => [key(`${item.topic}\n${item.practice}`), item]));
  const newSuggestions = new Map(newer.suggestions.map(item => [key(`${item.topic}\n${item.practice}`), item]));
  return {
    older: older.meta,
    newer: newer.meta,
    limitations,
    comparable: limitations.length === 0,
    changes,
    findingReview,
    suggestions: {
      added: [...newSuggestions].filter(([identity]) => !oldSuggestions.has(identity)).map(([, item]) => item),
      removed: [...oldSuggestions].filter(([identity]) => !newSuggestions.has(identity)).map(([, item]) => item),
    },
  };
}
