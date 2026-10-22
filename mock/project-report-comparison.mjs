const key = value => value.trim().replace(/\s+/g, ' ').toLocaleLowerCase();

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
  if (sameRepositoryIdentity && older.baselineVersionId && older.baselineVersionId === newer.baselineVersionId && older.branch === newer.branch && older.goal === newer.goal) {
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
    for (const requirementId of new Set([...before.keys(), ...after.keys()])) {
      const oldFindings = before.get(requirementId) || [], newFindings = after.get(requirementId) || [];
      // Multiple conclusions for one requirement cannot be matched safely across reports.
      if (oldFindings.length !== 1 || newFindings.length !== 1) continue;
      const previous = oldFindings[0], current = newFindings[0];
      if (previous.status === current.status) continue;
      const kind = current.status === 'implemented' ? 'completion_signal'
        : previous.status === 'implemented' ? 'possible_regression'
          : current.status === 'not_found' ? 'new_gap'
            : previous.status === 'not_found' ? 'improved_gap' : 'changed';
      changes.push({ requirementId, kind, before: previous, after: current });
    }
  }

  const oldSuggestions = new Map(older.suggestions.map(item => [key(`${item.topic}\n${item.practice}`), item]));
  const newSuggestions = new Map(newer.suggestions.map(item => [key(`${item.topic}\n${item.practice}`), item]));
  return {
    older: older.meta,
    newer: newer.meta,
    limitations,
    comparable: limitations.length === 0,
    changes,
    suggestions: {
      added: [...newSuggestions].filter(([identity]) => !oldSuggestions.has(identity)).map(([, item]) => item),
      removed: [...oldSuggestions].filter(([identity]) => !newSuggestions.has(identity)).map(([, item]) => item),
    },
  };
}
