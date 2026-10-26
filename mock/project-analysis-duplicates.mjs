import { containsKnownSecret } from './project-scan.mjs';

export const DUPLICATE_CANDIDATE_LIMIT = 12;
const excerpt = value => Array.from(String(value || '')).slice(0,240).join('');

export async function snapshotAcceptedProjectSuggestions(client, { repositoryId, ownerId, branch, githubRepositoryId }) {
  if (!githubRepositoryId) return [];
  const rows = (await client.query(`SELECT * FROM (
    SELECT DISTINCT ON (d.task_id) d.task_id,t.title,s.topic,
      COALESCE(adj.practice,s.practice) AS practice,COALESCE(adj.acceptance,s.acceptance) AS acceptance,
      d.decided_at,d.suggestion_id
    FROM project_suggestion_decisions d
    JOIN project_analysis_suggestions s ON s.id=d.suggestion_id
    JOIN project_analyses a ON a.id=s.analysis_id AND a.repository_id=d.repository_id
    JOIN project_scans sc ON sc.id=a.scan_id AND sc.repository_id=a.repository_id
    JOIN tasks t ON t.id=d.task_id AND t.owner_id=d.owner_id AND t.deleted_at IS NULL
    LEFT JOIN project_suggestion_adjustments adj ON adj.suggestion_id=s.id
    WHERE d.repository_id=$1 AND d.owner_id=$2 AND d.state='accepted'
      AND a.branch=$3 AND sc.branch=a.branch AND sc.commit_sha=a.commit_sha
      AND sc.github_repository_id=$4
    ORDER BY d.task_id,d.decided_at DESC,d.suggestion_id DESC
  ) recent ORDER BY decided_at DESC,suggestion_id DESC LIMIT $5`,
  [repositoryId,ownerId,branch,githubRepositoryId,DUPLICATE_CANDIDATE_LIMIT])).rows;
  return rows.filter(row => ![row.title,row.topic,row.practice,row.acceptance].some(containsKnownSecret))
    .map(row => ({ taskId: row.task_id, title: excerpt(row.title), topic: excerpt(row.topic), practice: excerpt(row.practice), acceptance: excerpt(row.acceptance) }));
}

export const candidateTaskIds = job => new Set((job.analysis_plan_version >= 11 && Array.isArray(job.duplicate_candidates) ? job.duplicate_candidates : []).map(item => item.taskId));
