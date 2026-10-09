import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PDFDocument } from 'pdf-lib';
import { makeModelCostPdf } from '../src/utils/modelCostPdf.ts';

test('model cost PDF includes a chart and paginates long breakdowns', async () => {
  const font = await readFile(new URL('../public/fonts/NotoSansCJKsc-Regular.otf', import.meta.url));
  const report = {
    start: '2026-10-01', end: '2026-10-31', dimension: 'model', timezone: 'UTC', totalUsd: '12.345678901234',
    trend: [{ day: '2026-10-01', costUsd: '1.000000000000' }, { day: '2026-10-02', costUsd: '2.000000000000' }],
    breakdown: Array.from({ length: 43 }, (_, index) => ({ key: String(index), name: `测试模型 ${index}`, costUsd: '0.123456789012', runParts: 2 })),
    filters: { models: [], users: [] },
  };
  const blob = await makeModelCostPdf(report, font);
  assert.equal(blob.type, 'application/pdf');
  const document = await PDFDocument.load(await blob.arrayBuffer());
  assert.equal(document.getPageCount(), 4);
  assert.equal(document.getTitle(), '模型成本报告');
});
