import crypto from 'node:crypto';
import { parseProjectRequirements, validateCrossModuleFlows, validateProjectReport } from './project-analysis-core.mjs';
import { candidateTaskIds } from './project-analysis-duplicates.mjs';

export function projectCallFingerprint(job, group) {
  const input = JSON.parse(group.messages[1].content);
  delete input.commitSha;
  const value = {
    version: 1,
    kind: group.kind,
    moduleKey: group.moduleKey,
    modelId: job.model_id,
    provider: job.provider,
    apiModel: job.api_model,
    connectionId: job.connection_id || null,
    connectionVersion: job.connection_version,
    baselineVersionId: job.baseline_version_id || null,
    parameters: { temperature: 0, maxTokens: 2048 },
    systemPrompt: group.messages[0].content,
    input,
  };
  return crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

export function cachedProjectCallValid(job, group, output) {
  try {
    if (group.kind === 'cross') validateCrossModuleFlows(output,group.files);
    else validateProjectReport(output,group.files,{ maxFindings: 5, maxSuggestions: 3, requirementIds: parseProjectRequirements(job.requirement_document).map(item => item.id), duplicateCandidateTaskIds: job.analysis_plan_version >= 11 ? candidateTaskIds(job) : null });
    return true;
  } catch { return false; }
}

export async function findReusableProjectCalls(client, job, plan, impactedModules = new Set()) {
  const reusable = new Map();
  for (const group of plan) {
    if (group.kind === 'cross' || impactedModules.has(group.moduleKey)) continue;
    const fingerprint = projectCallFingerprint(job,group);
    const rows = (await client.query(`SELECT c.response_output,a.id AS source_analysis_id,a.commit_sha AS source_commit_sha
      FROM project_analysis_module_calls c JOIN project_analyses a ON a.id=c.analysis_id
      JOIN project_scans s ON s.id=a.scan_id
      WHERE a.repository_id=$1 AND a.status='completed' AND c.module_key=$2 AND c.input_fingerprint=$3
        AND s.github_repository_id=$4
        AND c.status='completed' AND c.response_output IS NOT NULL
      ORDER BY a.created_at DESC,c.completed_at DESC LIMIT 3`,[job.repository_id,group.moduleKey,fingerprint,job.github_repository_id])).rows;
    const match = rows.find(row => cachedProjectCallValid(job,group,row.response_output));
    if (match) reusable.set(group.moduleKey,{ fingerprint, output: match.response_output, sourceAnalysisId: match.source_analysis_id, sourceCommitSha: match.source_commit_sha.trim() });
  }
  return reusable;
}
