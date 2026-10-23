import crypto from 'node:crypto';
import pg from 'pg';
import { appendSecurityAudit } from './account-audit.mjs';
import { canAccess } from './permissions.mjs';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const OUTCOMES = new Set(['matched','follow_up','no_longer_relevant']);
const fail = (status, error) => ({ status, data: { error } });
const normalized = value => String(value || '').normalize('NFKC').toLocaleLowerCase().replace(/[\p{P}\p{S}\s]+/gu,'');
const sha = value => String(value || '').trim();

function bigrams(value) {
  const characters = [...normalized(value)];
  if (characters.length < 2) return characters;
  return characters.slice(1).map((character,index) => characters[index] + character);
}

function dice(left,right) {
  const first = bigrams(left), second = bigrams(right);
  if (!first.length || !second.length) return 0;
  const counts = new Map();
  for (const pair of first) counts.set(pair,(counts.get(pair) || 0) + 1);
  let shared = 0;
  for (const pair of second) {
    const available = counts.get(pair) || 0;
    if (available) { shared++; counts.set(pair,available - 1); }
  }
  return 2 * shared / (first.length + second.length);
}

function rankedCandidates(older,newer,sameBaseline) {
  return newer.map(item => ({
    id: item.id,
    topic: item.topic,
    practice: item.practice,
    acceptance: item.acceptance,
    requirementId: item.requirement_id,
    sameRequirement: Boolean(sameBaseline && older.requirement_id && older.requirement_id === item.requirement_id),
    similarity: Math.round((dice(older.topic,item.topic) * 0.4
      + dice(older.practice,item.practice) * 0.45
      + dice(older.acceptance,item.acceptance) * 0.15) * 100) / 100,
    position: item.position,
  })).sort((a,b) => Number(b.sameRequirement) - Number(a.sameRequirement)
    || b.similarity - a.similarity || a.position - b.position || a.id.localeCompare(b.id))
    .map(({ position,...candidate }) => candidate);
}

function reportLimitations(older,newer) {
  const limitations = [];
  if (older.goal !== newer.goal) limitations.push('项目目标不同，建议仅供人工参考');
  if (!older.baseline_version_id || older.baseline_version_id !== newer.baseline_version_id)
    limitations.push('需求基线版本不同或缺失，候选建议不标记为同一需求，不能自动判断是否已解决');
  if (!older.analysis_coverage_complete || !newer.analysis_coverage_complete)
    limitations.push('至少一份报告只覆盖部分扫描内容');
  if (older.selected_file_count !== newer.selected_file_count || older.available_file_count !== newer.available_file_count)
    limitations.push('两次分析涉及的文件数量不同');
  return limitations;
}

function currentReportStale(repository,newer) {
  return !repository.github_repository_id || repository.github_repository_id !== newer.github_repository_id
    || repository.branch !== newer.branch || repository.goal !== newer.goal
    || repository.requirement_baseline !== newer.requirement_baseline
    || repository.baseline_version_id !== newer.baseline_version_id
    || sha(repository.commit_sha) !== sha(newer.commit_sha);
}

async function reportsForComparison(connection,repositoryId,olderId,newerId) {
  const rows = (await connection.query(`SELECT a.id,a.status,a.branch,a.commit_sha,a.goal,a.requirement_baseline,
      a.baseline_version_id,a.analysis_coverage_complete,a.selected_file_count,a.available_file_count,
      a.finished_at,s.github_repository_id,s.branch AS scan_branch,s.commit_sha AS scan_commit_sha
    FROM project_analyses a JOIN project_scans s ON s.id=a.scan_id AND s.repository_id=a.repository_id
    WHERE a.repository_id=$1 AND a.id=ANY($2::uuid[])`,[repositoryId,[olderId,newerId]])).rows;
  const older = rows.find(row => row.id === olderId), newer = rows.find(row => row.id === newerId);
  if (!older || !newer || older.status !== 'completed' || newer.status !== 'completed')
    return { error: fail(404,'已完成报告不存在') };
  if (!older.github_repository_id || older.github_repository_id !== newer.github_repository_id
    || older.branch !== newer.branch || older.branch !== older.scan_branch || newer.branch !== newer.scan_branch
    || sha(older.commit_sha) !== sha(older.scan_commit_sha) || sha(newer.commit_sha) !== sha(newer.scan_commit_sha))
    return { error: fail(409,'两份报告不是同一可信 GitHub 仓库及分支，无法复核') };
  if (!older.finished_at || !newer.finished_at
    || new Date(older.finished_at).getTime() >= new Date(newer.finished_at).getTime())
    return { error: fail(400,'请按完成时间选择较早和较新的报告') };
  return { older,newer };
}

function reviewValue(row) {
  return row ? { newerSuggestionId: row.newer_suggestion_id, outcome: row.outcome,
    note: row.note, version: row.version, reviewedAt: row.reviewed_at } : null;
}

export async function handleProjectSuggestionRechecks({ pathname, method, client, me, url, readBody, req }) {
  const match = pathname.match(/^\/api\/project-repositories\/([^/]+)\/analyses\/([^/]+)\/suggestion-reviews(?:\/([^/]+))?$/);
  if (!match) return null;
  const [,repositoryId,newerId,olderSuggestionId] = match;
  if (![repositoryId,newerId].every(value => UUID.test(value)) || olderSuggestionId && !UUID.test(olderSuggestionId))
    return fail(404,'项目或报告不存在');
  if (olderSuggestionId ? method !== 'POST' : method !== 'GET') return fail(405,'不支持该操作');

  const body = olderSuggestionId ? await readBody() : null;
  const olderId = olderSuggestionId ? body?.olderAnalysisId : url?.searchParams.get('olderAnalysisId');
  if (!UUID.test(olderId || '') || olderId === newerId) return fail(400,'请指定另一份较早报告');
  let note, targetSuggestionId;
  if (olderSuggestionId) {
    note = typeof body?.note === 'string' ? body.note.trim() : '';
    targetSuggestionId = body?.newerSuggestionId;
    if (!OUTCOMES.has(body?.outcome) || !Number.isInteger(body?.expectedVersion) || body.expectedVersion < 0
      || Array.from(note).length < 10 || Array.from(note).length > 1000
      || !(targetSuggestionId === null || typeof targetSuggestionId === 'string' && UUID.test(targetSuggestionId))
      || body.outcome === 'matched' && targetSuggestionId === null
      || body.outcome === 'no_longer_relevant' && targetSuggestionId !== null)
      return fail(400,'复核结论、候选建议、理由或版本无效');
  }

  const pooled = client instanceof pg.Pool;
  const connection = pooled ? await client.connect() : client;
  try {
    await connection.query(olderSuggestionId ? 'BEGIN' : 'BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    const repository = (await connection.query(`SELECT id,owner_id,github_repository_id,branch,goal,
      requirement_baseline,baseline_version_id,commit_sha FROM project_repositories
      WHERE id=$1 AND owner_id=$2${olderSuggestionId ? ' FOR SHARE' : ''}`,[repositoryId,me.id])).rows[0];
    if (!repository) { await connection.query('ROLLBACK'); return fail(404,'项目不存在'); }
    const permission = olderSuggestionId ? ['project_suggestions','manage'] : ['project_analyses','read'];
    if (!canAccess(me,permission[0],permission[1],{ ownerId: repository.owner_id })) {
      await connection.query('ROLLBACK'); return fail(403,'无权复核项目建议');
    }
    const { older,newer,error } = await reportsForComparison(connection,repositoryId,olderId,newerId);
    if (error) { await connection.query('ROLLBACK'); return error; }
    const stale = currentReportStale(repository,newer);
    if (olderSuggestionId) {
      if (stale) { await connection.query('ROLLBACK'); return fail(409,'新报告已不符合当前项目目标、需求基线、commit、分支或仓库身份，请重新分析'); }
      const oldSuggestion = (await connection.query('SELECT id FROM project_analysis_suggestions WHERE id=$1 AND analysis_id=$2',[olderSuggestionId,olderId])).rows[0];
      if (!oldSuggestion) { await connection.query('ROLLBACK'); return fail(404,'旧建议不存在'); }
      if (targetSuggestionId && !(await connection.query('SELECT 1 FROM project_analysis_suggestions WHERE id=$1 AND analysis_id=$2',[targetSuggestionId,newerId])).rowCount) {
        await connection.query('ROLLBACK'); return fail(400,'所选候选建议不属于新报告');
      }
      const previous = (await connection.query(`SELECT id,version FROM project_suggestion_rechecks
        WHERE older_suggestion_id=$1 AND newer_analysis_id=$2 FOR UPDATE`,[olderSuggestionId,newerId])).rows[0];
      if ((previous?.version || 0) !== body.expectedVersion) {
        await connection.query('ROLLBACK'); return fail(409,'复核版本已变化，请刷新后重试');
      }
      const saved = previous
        ? (await connection.query(`UPDATE project_suggestion_rechecks SET newer_suggestion_id=$2,outcome=$3,note=$4,
          version=version+1,reviewed_by=$5,reviewed_at=now() WHERE id=$1
          RETURNING id,newer_suggestion_id,outcome,note,version,reviewed_at`,
        [previous.id,targetSuggestionId,body.outcome,note,me.id])).rows[0]
        : (await connection.query(`INSERT INTO project_suggestion_rechecks
          (id,repository_id,owner_id,older_analysis_id,newer_analysis_id,older_suggestion_id,
            newer_suggestion_id,outcome,note,reviewed_by)
          VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
          RETURNING id,newer_suggestion_id,outcome,note,version,reviewed_at`,
        [crypto.randomUUID(),repositoryId,me.id,olderId,newerId,olderSuggestionId,targetSuggestionId,body.outcome,note,me.id])).rows[0];
      await connection.query(`INSERT INTO project_suggestion_recheck_events
        (recheck_id,version,newer_suggestion_id,outcome,note,reviewed_by,reviewed_at)
        VALUES($1,$2,$3,$4,$5,$6,$7)`,
      [saved.id,saved.version,saved.newer_suggestion_id,saved.outcome,saved.note,me.id,saved.reviewed_at]);
      if (req) await appendSecurityAudit(connection,req,me,'review','project_suggestion_rechecks',saved.id,
        { repositoryId,olderAnalysisId:olderId,newerAnalysisId:newerId,olderSuggestionId,
          newerSuggestionId:targetSuggestionId,outcome:body.outcome,version:saved.version });
      await connection.query('COMMIT');
      return { status: 200, data: reviewValue(saved) };
    }

    const suggestions = (await connection.query(`SELECT s.id,s.analysis_id,s.position,s.topic,
        s.practice,s.acceptance,
        f.requirement_id,d.state AS decision_state,d.task_id
      FROM project_analysis_suggestions s
      LEFT JOIN project_analysis_findings f ON f.id=s.finding_id AND f.analysis_id=s.analysis_id
      LEFT JOIN project_suggestion_decisions d ON d.suggestion_id=s.id
      WHERE s.analysis_id=ANY($1::uuid[]) ORDER BY s.analysis_id,s.position`,[[olderId,newerId]])).rows;
    const olderSuggestions = suggestions.filter(row => row.analysis_id === olderId);
    const newerSuggestions = suggestions.filter(row => row.analysis_id === newerId);
    const reviews = (await connection.query(`SELECT older_suggestion_id,newer_suggestion_id,outcome,note,version,reviewed_at
      FROM project_suggestion_rechecks WHERE older_analysis_id=$1 AND newer_analysis_id=$2`,[olderId,newerId])).rows;
    const reviewBySuggestion = new Map(reviews.map(row => [row.older_suggestion_id,row]));
    await connection.query('COMMIT');
    const limitations = reportLimitations(older,newer);
    if (stale) limitations.push('新报告与当前项目配置不一致，更新复核前请重新分析');
    return { status: 200, data: {
      olderAnalysisId:olderId,newerAnalysisId:newerId,
      olderCommitSha:sha(older.commit_sha),newerCommitSha:sha(newer.commit_sha),
      limitations,stale,
      items: olderSuggestions.map(item => ({
        older: { id:item.id,topic:item.topic,practice:item.practice,acceptance:item.acceptance,
          status:item.decision_state || 'pending',requirementId:item.requirement_id,taskId:item.task_id },
        candidates: rankedCandidates(item,newerSuggestions,
          Boolean(older.baseline_version_id && older.baseline_version_id === newer.baseline_version_id)),
        review: reviewValue(reviewBySuggestion.get(item.id)),
      })),
    } };
  } catch (error) {
    await connection.query('ROLLBACK').catch(() => undefined);
    if (error.code === '23505') return fail(409,'复核版本已变化，请刷新后重试');
    throw error;
  } finally { if (pooled) connection.release(); }
}
