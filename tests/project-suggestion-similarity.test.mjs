import test from 'node:test';
import assert from 'node:assert/strict';
import { relatedAcceptedSuggestions } from '../mock/project-suggestion-similarity.mjs';

test('related accepted tasks are hints for paraphrased suggestions, not automatic decisions', () => {
  const accepted = [
    { taskId: 'related', title: '验证入口', topic: '验证入口', practice: '添加集成测试' },
    { taskId: 'other', title: '配置模型预算', topic: '配置模型预算', practice: '设置每日额度' },
  ];
  assert.deepEqual(relatedAcceptedSuggestions({ topic: '验证应用入口', practice: '为入口添加集成测试' }, accepted), [
    { taskId: 'related', title: '验证入口', exact: false, similarity: 0.66 },
  ]);
  assert.deepEqual(relatedAcceptedSuggestions({ topic: ' 验证入口！', practice: '添加集成测试。' }, accepted)[0],
    { taskId: 'related', title: '验证入口', exact: true, similarity: 1 });
  assert.deepEqual(relatedAcceptedSuggestions({ topic: '部署数据库', practice: '检查备份恢复' }, accepted), []);
});
