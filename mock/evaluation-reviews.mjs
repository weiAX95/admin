export const REVIEW_DIMENSIONS = Object.freeze(['accuracy', 'completeness', 'brevity', 'safety']);

export function weightedKappa(pairs) {
  if (!pairs.length) return null;
  const count = pairs.length;
  const left = Array(11).fill(0), right = Array(11).fill(0);
  let observed = 0;
  for (const [a, b] of pairs) {
    left[a]++; right[b]++;
    observed += (a - b) ** 2 / 100;
  }
  observed /= count;
  let expected = 0;
  for (let a = 0; a <= 10; a++) for (let b = 0; b <= 10; b++) expected += (left[a] / count) * (right[b] / count) * (a - b) ** 2 / 100;
  return expected === 0 ? observed === 0 ? 1 : 0 : 1 - observed / expected;
}

export function reviewSummary(scores) {
  const grouped = new Map();
  for (const score of scores) {
    if (!grouped.has(score.run_id)) grouped.set(score.run_id, []);
    grouped.get(score.run_id).push(score);
  }
  const pairs = [...grouped].flatMap(([runId, values]) => {
    const primary = values.filter(item => item.role === 'primary').sort((a,b) => a.reviewer_id.localeCompare(b.reviewer_id));
    return primary.length === 2 ? [{ runId, left: primary[0], right: primary[1], adjudicated: values.some(item => item.role === 'adjudicator') }] : [];
  });
  const byDimension = Object.fromEntries(REVIEW_DIMENSIONS.map(dimension => [dimension, weightedKappa(pairs.map(pair => [pair.left[dimension], pair.right[dimension]]))]));
  const available = Object.values(byDimension).filter(value => value !== null);
  const overallKappa = available.length ? available.reduce((sum, value) => sum + value, 0) / available.length : null;
  const disputes = pairs.flatMap(pair => {
    const dimensions = REVIEW_DIMENSIONS.filter(dimension => Math.abs(pair.left[dimension] - pair.right[dimension]) >= 3);
    return dimensions.length ? [{ runId: pair.runId, dimensions, adjudicated: pair.adjudicated }] : [];
  });
  const distribution = Array.from({ length: 11 }, (_, score) => ({ score, count: pairs.filter(pair => Math.round(REVIEW_DIMENSIONS.reduce((sum, dimension) => sum + pair.left[dimension] + pair.right[dimension], 0) / 8) === score).length }));
  return { reviewedPairs: pairs.length, kappa: byDimension, overallKappa, qualityWarning: overallKappa !== null && overallKappa < 0.6, disputes, distribution };
}
