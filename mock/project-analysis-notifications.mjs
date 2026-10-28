import { compareProjectReports } from './project-report-comparison.mjs';
import { notifyUser } from './app-notifications.mjs';

const reportView = (row, findings, suggestions) => ({
  meta: { id: row.id }, branch: row.branch,
  githubRepositoryId: row.github_repository_id,
  baselineVersionId: row.baseline_version_id, goal: row.goal,
  analysisCoverageComplete: row.analysis_coverage_complete,
  selectedFileCount: row.selected_file_count,
  availableFileCount: row.available_file_count,
  selectedFilePaths: row.selected_file_paths,
  modelId: row.model_id,
  analysisPlanVersion: row.analysis_plan_version,
  findings: findings.filter(item => item.analysis_id === row.id).map(item => ({
    requirementId: item.requirement_id, status: item.status, title: item.title,
  })),
  suggestions: suggestions.filter(item => item.analysis_id === row.id).map(item => ({
    topic: item.topic, practice: item.practice, impact: item.impact,
  })),
});

export async function processProjectAnalysisNotifications(pool) {
  let processed = 0;
  for (let index = 0; index < 10; index++) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const current = (await client.query(`SELECT a.*,s.github_repository_id FROM project_analyses a
        JOIN project_scans s ON s.id=a.scan_id
        WHERE a.change_notification_state='pending' AND a.status='completed'
        ORDER BY a.finished_at,a.id LIMIT 1 FOR UPDATE OF a SKIP LOCKED`)).rows[0];
      if (!current) { await client.query('COMMIT'); break; }
      const previous = (await client.query(`SELECT a.*,s.github_repository_id FROM project_analyses a
        JOIN project_scans s ON s.id=a.scan_id
        WHERE a.repository_id=$1 AND a.status='completed' AND a.id<>$2
          AND a.finished_at<$3 AND a.branch=$4 AND a.baseline_version_id=$5
          AND a.goal=$6 AND a.analysis_coverage_complete=true
          AND a.selected_file_count=$7 AND a.available_file_count=$8
          AND s.github_repository_id=$9
        ORDER BY a.finished_at DESC,a.id DESC LIMIT 1`, [current.repository_id,current.id,current.finished_at,current.branch,current.baseline_version_id,current.goal,current.selected_file_count,current.available_file_count,current.github_repository_id])).rows[0];
      let notificationState = 'skipped';
      if (previous && current.analysis_coverage_complete) {
        const ids = [previous.id,current.id];
        const findings = (await client.query('SELECT analysis_id,requirement_id,status,title FROM project_analysis_findings WHERE analysis_id=ANY($1::uuid[]) ORDER BY position',[ids])).rows;
        const suggestions = (await client.query('SELECT analysis_id,topic,practice,impact FROM project_analysis_suggestions WHERE analysis_id=ANY($1::uuid[]) ORDER BY position',[ids])).rows;
        const comparison = compareProjectReports(reportView(previous,findings,suggestions),reportView(current,findings,suggestions));
        if (comparison.comparable) {
          const progress = comparison.changes.filter(item => item.kind === 'completion_signal').length;
          const blockers = comparison.changes.filter(item => ['possible_regression','new_gap'].includes(item.kind)).length;
          const decisions = comparison.suggestions.added.filter(item => item.impact === 'high').length;
          if (progress || blockers || decisions) {
            const parts = [progress && `${progress} 项需求出现完成线索`,blockers && `${blockers} 项出现新缺口或可能退化`,decisions && `${decisions} 条高影响学习建议待决策`].filter(Boolean);
            const sent = await notifyUser(client,current.owner_id,'project_analysis_change',current.id,
              `${current.full_name} 有值得关注的分析变化`,
              `${parts.join('；')}。这是固定 commit 的代码证据对比，仍需人工验证。`,
              `/project-analysis?repositoryId=${current.repository_id}&analysisId=${current.id}`);
            if (sent) notificationState = 'sent';
          }
        }
      }
      await client.query('UPDATE project_analyses SET change_notification_state=$2 WHERE id=$1',[current.id,notificationState]);
      await client.query('COMMIT');
      processed++;
    } catch (error) { await client.query('ROLLBACK').catch(() => undefined); throw error; }
    finally { client.release(); }
  }
  return processed;
}
