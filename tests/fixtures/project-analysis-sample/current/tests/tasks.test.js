import { strict as assert } from 'node:assert';
import { createTask } from '../src/tasks.js';

const created = createTask('学习');
assert.ok(created.id);
assert.equal(created.title, '学习');
