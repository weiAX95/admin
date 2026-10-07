import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scanPrompt } from '../mock/prompts.mjs';

const client = { query: async () => ({ rows: [] }) };
const positive = [
  ['phone','联系 13812345678'],['phone','电话 15987654321'],
  ['identity','身份证 110101199003071234'],['identity','号码 32010219881206321X'],
  ['email','邮箱 alice@example.com'],['email','请发 bob.smith+work@example.cn'],
  ['secret','sk-abcdefghijklmnopqrstuv'],['secret','api_key=abcdefghijklmnop'],
];
const negative = [
  '今天讨论架构设计', '普通变量 {{topic}}', '请对齐 2026 年计划', '手机号长度不足 1381234567',
  '编号 12345678901234567890', '版本 v1.2.3', '项目 API key 需要设置', '使用 sk- 前缀举例',
  '邮箱格式应该有 @ 符号', 'a.example.com', '任务 #1234', '一次完成两项任务',
  '模型 temperature=0.7', '错误码 500', '文件名 output.json', 'URL https://example.com',
  'system prompt', '学习 React Hooks', '业务编号 ABC-2026', '纯文本备注',
];

test('known-pattern compliance corpus has zero misses and under five percent false positives', async () => {
  const scan = async content => scanPrompt(client,{content,messages:[]});
  for (const [kind,content] of positive) assert.ok((await scan(content)).includes(kind),`${kind}: ${content}`);
  let falsePositives = 0;
  for (const content of negative) if ((await scan(content)).length) falsePositives++;
  assert.ok(falsePositives / negative.length < .05, `false positive rate ${falsePositives}/${negative.length}`);
});
