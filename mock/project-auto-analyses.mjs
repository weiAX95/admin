import { CURRENT_ANALYSIS_PLAN_VERSION, handleProjectAnalyses } from './project-analyses.mjs';
import { notifyUser } from './app-notifications.mjs';

export async function processProjectAutoAnalyses(pool) {
  const claimed = (await pool.query(`WITH next AS (
      SELECT id FROM project_scans
      WHERE trigger_source='webhook' AND status IN ('completed','partial')
        AND (auto_analysis_state='pending' OR auto_analysis_state='processing' AND auto_analysis_started_at<now()-interval '10 minutes')
      ORDER BY created_at,id LIMIT 10 FOR UPDATE SKIP LOCKED
    ) UPDATE project_scans s SET auto_analysis_state='processing',auto_analysis_started_at=now(),auto_analysis_error=NULL
      FROM next WHERE s.id=next.id RETURNING s.id,s.repository_id,s.github_repository_id,s.commit_sha,s.coverage_complete,s.baseline_commit_sha`)).rows;
  for (const scan of claimed) {
    let status = 'failed', error = null, analysisId = null;
    let approvalOwner = null, approvalRepository = null;
    try {
      const row = (await pool.query(`SELECT r.id,r.owner_id,r.full_name,r.github_repository_id,r.commit_sha,r.goal,r.requirement_baseline,r.baseline_version_id,r.is_private,r.webhook_scan_enabled,r.auto_analysis_enabled,
          r.auto_analysis_model_id,r.auto_analysis_token_budget,r.auto_analysis_cost_budget_usd,u.role,u.status AS user_status
        FROM project_repositories r JOIN users u ON u.id=r.owner_id WHERE r.id=$1`,[scan.repository_id])).rows[0];
      if (!row || !row.github_repository_id || !scan.github_repository_id || row.github_repository_id !== scan.github_repository_id
        || row.user_status !== 'active' || !row.webhook_scan_enabled || !row.auto_analysis_enabled || row.commit_sha.trim() !== scan.commit_sha.trim()) {
        status = 'skipped';
        error = '仓库身份、项目设置或提交已变化';
      } else if (scan.coverage_complete && scan.baseline_commit_sha && (await pool.query(`SELECT 1 FROM project_scans prior
          JOIN project_analyses a ON a.scan_id=prior.id AND a.status='completed' AND a.analysis_coverage_complete=true
          WHERE prior.repository_id=$1 AND prior.github_repository_id=$9 AND prior.commit_sha=$2 AND prior.coverage_complete=true
            AND a.model_id=$3 AND a.goal=$4 AND a.requirement_baseline=$5
            AND a.baseline_version_id IS NOT DISTINCT FROM $6::uuid
            AND a.analysis_plan_version=$7
            AND NOT EXISTS (SELECT 1 FROM project_scan_changes WHERE scan_id=$8)
          LIMIT 1`,[row.id,scan.baseline_commit_sha,row.auto_analysis_model_id,row.goal,row.requirement_baseline,row.baseline_version_id,CURRENT_ANALYSIS_PLAN_VERSION,scan.id,scan.github_repository_id])).rowCount) {
        status = 'skipped';
        error = '与前次完整报告相比没有文件变化，已跳过重复分析';
      } else if (row.is_private) {
        const existing = (await pool.query("SELECT id,status FROM project_analyses WHERE scan_id=$1 AND model_id=$2 AND status IN ('queued','analyzing','completed') ORDER BY created_at DESC LIMIT 1",[scan.id,row.auto_analysis_model_id])).rows[0];
        if (existing) {
          status = existing.status === 'completed' ? 'skipped' : 'queued';
          analysisId = existing.id;
          error = existing.status === 'completed' ? '本次扫描已有已完成报告' : null;
        } else {
          status = 'approval_required';
          error = '请先查看本次代码发送范围并确认分析';
          approvalOwner = row.owner_id;
          approvalRepository = row.full_name;
        }
      } else {
        const response = await handleProjectAnalyses({
          pathname: `/api/project-repositories/${row.id}/analyses`, method: 'POST', client: pool,
          me: { id: row.owner_id, role: row.role }, triggerSource: 'webhook',
          readBody: async () => ({ scanId: scan.id, modelId: row.auto_analysis_model_id,
            tokenBudget: row.auto_analysis_token_budget, costBudgetUsd: Number(row.auto_analysis_cost_budget_usd) }),
        });
        if (response?.status === 202 && response.data?.id) { status = 'queued'; analysisId = response.data.id; }
        else error = String(response?.data?.error || '自动分析提交失败').slice(0,500);
      }
    } catch { error = '自动分析服务暂不可用'; }
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      if (status === 'approval_required') {
        const enabled = (await client.query('SELECT 1 FROM project_repositories WHERE id=$1 AND webhook_scan_enabled=true AND auto_analysis_enabled=true AND commit_sha=$2 AND github_repository_id=$3 FOR SHARE',[scan.repository_id,scan.commit_sha,scan.github_repository_id])).rowCount;
        if (!enabled) { status = 'skipped'; error = '项目设置已关闭或已有更新的提交'; }
      }
      const updated = await client.query(`UPDATE project_scans SET auto_analysis_state=$2,auto_analysis_error=$3,auto_analysis_id=$4,
        auto_analysis_started_at=NULL WHERE id=$1 AND auto_analysis_state='processing' RETURNING id`,[scan.id,status,error,analysisId]);
      if (updated.rowCount && status === 'approval_required') await notifyUser(client,approvalOwner,'project_analysis_approval',scan.id,
        `${approvalRepository} 的私有代码分析待确认`,
        `提交 ${scan.commit_sha.trim().slice(0,10)} 已扫描完成。请查看本次发送范围并确认，确认前不会调用模型。`,
        `/project-analysis?repositoryId=${scan.repository_id}`);
      await client.query('COMMIT');
    } catch (cause) { await client.query('ROLLBACK').catch(() => undefined); throw cause; }
    finally { client.release(); }
  }
  return claimed.length;
}
