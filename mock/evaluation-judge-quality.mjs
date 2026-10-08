export function pearson(pairs) {
  const valid = pairs.filter(([a,b]) => Number.isFinite(a) && Number.isFinite(b));
  if (valid.length < 2) return null;
  const meanA = valid.reduce((sum,[a]) => sum+a,0)/valid.length;
  const meanB = valid.reduce((sum,[,b]) => sum+b,0)/valid.length;
  const numerator = valid.reduce((sum,[a,b]) => sum+(a-meanA)*(b-meanB),0);
  const denominator = Math.sqrt(valid.reduce((sum,[a]) => sum+(a-meanA)**2,0)*valid.reduce((sum,[,b]) => sum+(b-meanB)**2,0));
  return denominator ? Math.round(numerator/denominator*1000)/1000 : null;
}

export function judgeQuality(rows) {
  const dimensions = { accuracy:'accuracy',completeness:'completeness',conciseness:'brevity',safety:'safety' };
  const byDimension = Object.fromEntries(Object.entries(dimensions).map(([judge,human]) => {
    const pairs = rows.filter(row => row.judgeDimensions && Number.isFinite(row.judgeDimensions[judge]) && Number.isFinite(row.human[human])).map(row => [row.judgeDimensions[judge],row.human[human]]);
    return [judge,{count:pairs.length,pearson:pearson(pairs)}];
  }));
  const overall = rows.filter(row => Number.isFinite(row.judgeScore) && row.human && Object.values(dimensions).every(key => Number.isFinite(row.human[key]))).map(row => [row.judgeScore, Object.values(dimensions).reduce((sum,key)=>sum+row.human[key],0)/8]);
  return { count:overall.length,overallPearson:pearson(overall),dimensions:byDimension,thresholdMet:overall.length>=2 && pearson(overall)!==null ? pearson(overall)>0.7 : null };
}
