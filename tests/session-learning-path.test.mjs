import test from 'node:test';
import assert from 'node:assert/strict';
import { analyzeLearningPath } from '../mock/session-learning-path.mjs';
import { basicFixture, createPgTestServer } from './pg-helper.mjs';

const session = (id, question, createdAt = '2026-01-01T00:00:00.000Z') => ({ id, title: question, createdAt, questions: [question] });

test('recognizes linear deepening, breadth expansion and review as distinct evidence-based patterns', () => {
  const linear = analyzeLearningPath([
    session('a', 'React 是什么'), session('b', 'React 性能优化原理'), session('c', 'React 项目如何部署'),
  ]);
  assert.deepEqual(linear.sessions.map(item => item.stage), ['basic', 'advanced', 'practical']);
  assert.deepEqual(linear.patterns.map(item => item.id), ['linear']);

  const breadth = analyzeLearningPath([session('a', 'React 是什么'), session('b', 'SQL 是什么'), session('c', 'Docker 是什么')]);
  assert.deepEqual(breadth.patterns.map(item => item.id), ['breadth']);
  assert.equal(breadth.topicCount, 3);

  const review = analyzeLearningPath([session('a', 'React 性能优化原理'), session('b', 'React 项目如何部署'), session('c', 'React 基础概念复习')]);
  assert.deepEqual(review.patterns.map(item => item.id), ['review']);
  assert.deepEqual(review.sessions.map(item => item.stage), ['advanced', 'practical', 'basic']);
  const unknown = analyzeLearningPath([session('a', '随便聊聊')]);
  assert.equal(unknown.sessions[0].stage, 'unknown');
  assert.equal(unknown.patterns.length, 0);
  assert.equal(analyzeLearningPath([session('a', 'React SQL Docker 是什么')]).patterns.length, 0);
});

test('learning path orders one external user sessions without mixing another user', async t => {
  const fixture = basicFixture();
  const dates = [3, 2, 1].map(days => new Date(Date.now() - days * 86400000).toISOString());
  fixture.sessions = [
    { id: 'late', userId: 'chat-a', createdAt: dates[2], updatedAt: dates[2], messages: [{ id: 'q3', role: 'user', content: 'React 项目部署', at: dates[2] }] },
    { id: 'early', userId: 'chat-a', createdAt: dates[0], updatedAt: dates[0], messages: [{ id: 'q1', role: 'user', content: 'React 是什么', at: dates[0] }] },
    { id: 'middle', userId: 'chat-a', createdAt: dates[1], updatedAt: dates[1], messages: [{ id: 'q2', role: 'user', content: 'React 性能优化', at: dates[1] }] },
    { id: 'other', userId: 'chat-b', createdAt: dates[1], updatedAt: dates[1], messages: [{ id: 'q4', role: 'user', content: 'Docker 是什么', at: dates[1] }] },
  ];
  const { base } = await createPgTestServer(t, fixture);
  assert.equal((await fetch(`${base}/sessions/learning-path?userId=chat-a`)).status, 401);
  const login = await fetch(`${base}/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'member', password: 'test' }) });
  const { token } = await login.json();
  const response = await fetch(`${base}/sessions/learning-path?userId=chat-a`, { headers: { Authorization: `Bearer ${token}` } });
  assert.equal(response.status, 200);
  const result = await response.json();
  assert.equal(result.userId, 'chat-a');
  assert.deepEqual(result.sessions.map(item => item.sessionId), ['early', 'middle', 'late']);
  assert.deepEqual(result.patterns.map(item => item.id), ['linear']);
  assert.equal((await fetch(`${base}/sessions/learning-path?userId=`, { headers: { Authorization: `Bearer ${token}` } })).status, 400);
});
