const STAGES = [
  { id: 'basic', label: '基础概念', pattern: /是什么|什么是|概念|入门|基础|介绍|what is|basics?|introduction/i },
  { id: 'advanced', label: '进阶用法', pattern: /原理|机制|源码|性能|优化|进阶|并发|架构|设计模式|advanced|internals?|optimi[sz]e|performance/i },
  { id: 'practical', label: '实战问题', pattern: /实战|项目|实现|部署|报错|调试|故障|上线|运行|代码|build|implement|deploy|debug|error/i },
];
const TOPICS = [
  ['React', /react|组件|hooks?/i], ['TypeScript', /typescript|\bts\b/i], ['Python', /python|\bpy\b/i],
  ['SQL', /postgres|mysql|\bsql\b|数据库/i], ['Agent', /agent|智能体/i], ['模型', /大模型|\bllm\b|gpt|gemini|千问/i],
  ['API', /\bapi\b|接口/i], ['Docker', /docker|容器/i], ['Git', /\bgit\b|github/i],
];

export function analyzeLearningPath(rows) {
  const sessions = rows.map(row => {
    const questions = row.questions || [];
    const content = questions.join('\n');
    const stage = [...STAGES].reverse().find(item => item.pattern.test(content));
    return { sessionId: row.id, at: row.createdAt, title: row.title, questionCount: questions.length,
      stage: stage?.id || 'unknown', stageLabel: stage?.label || '未识别',
      topics: TOPICS.filter(([, pattern]) => pattern.test(content)).map(([label]) => label) };
  });
  const stageRank = { basic: 0, advanced: 1, practical: 2 };
  const recognized = sessions.filter(item => item.stage !== 'unknown');
  const patterns = [];
  const hasRise = recognized.some((item, index) => index > 0 && stageRank[item.stage] > stageRank[recognized[index - 1].stage]);
  const hasDrop = recognized.some((item, index) => index > 0 && stageRank[item.stage] < stageRank[recognized[index - 1].stage]);
  if (recognized.length >= 3 && hasRise && !hasDrop) patterns.push({ id: 'linear', label: '线性深入', detail: '提问从基础向进阶或实战推进，未出现阶段回退。' });
  const distinctTopics = new Set(sessions.flatMap(item => item.topics));
  if (distinctTopics.size >= 3 && sessions.filter(item => item.topics.length).length >= 3) patterns.push({ id: 'breadth', label: '广度拓展', detail: `多个会话涉及 ${distinctTopics.size} 个不同技术主题。` });
  if (hasDrop) patterns.push({ id: 'review', label: '回退复习', detail: '较高阶段之后再次出现基础或进阶问题。' });
  return { sessions, patterns, recognizedCount: recognized.length, topicCount: distinctTopics.size };
}

export async function getSessionLearningPath(pool, userId) {
  if (typeof userId !== 'string' || !userId.trim() || userId.length > 200) return { status: 400, data: { error: '请选择有效的聊天端用户 ID' } };
  const client = await pool.connect();
  try {
    await client.query('BEGIN READ ONLY');
    const result = await client.query(`SELECT s.id,s.created_at,m.content,m.item_order
      FROM sessions s LEFT JOIN session_messages m ON m.session_id=s.id AND m.role='user'
      WHERE s.external_user_id=$1 ORDER BY s.created_at,s.id,m.item_order`, [userId]);
    await client.query('COMMIT');
    const grouped = new Map();
    for (const row of result.rows) {
      if (!grouped.has(row.id)) grouped.set(row.id, { id: row.id, createdAt: row.created_at, title: '（无标题）', questions: [] });
      if (row.content !== null) {
        const item = grouped.get(row.id);
        if (!item.questions.length) item.title = row.content.slice(0, 40) || '（无标题）';
        item.questions.push(row.content);
      }
    }
    return { status: 200, data: { userId, ...analyzeLearningPath([...grouped.values()]) } };
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally { client.release(); }
}
