import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { PDFDocument } from 'pdf-lib';
import { makeRegressionPdf } from '../src/utils/experimentReportPdf.ts';

test('Chinese regression PDF paginates 50 cases with box plot and summaries', async () => {
  const cases=Array.from({length:50},(_,index)=>({caseKey:`测试用例-${index+1}`,variantId:'variant',score:4,baselineScore:4,delta:0,passed:true,difficulty:'基础',category:'推理',ruleScore:4,judgeScore:4}));
  const report={batchId:'batch',status:'completed',datasetVersionId:'dataset-v1',baselineBatchId:'baseline',metricVersionId:'default-v1',passThreshold:3,regressionThreshold:.5,total:50,scored:50,passRate:1,box:{min:4,q1:4,median:4,q3:4,max:4,count:50},degraded:[],byDifficulty:[{name:'基础',count:50,passRate:1,averageScore:4}],byCategory:[{name:'推理',count:50,passRate:1,averageScore:4}],cases};
  const font=readFileSync(new URL('../public/fonts/NotoSansCJKsc-Regular.otf',import.meta.url));
  const blob=await makeRegressionPdf(report,font);
  const bytes=await blob.arrayBuffer();
  const pdf=await PDFDocument.load(bytes);
  assert.equal(pdf.getPageCount(),4);
  assert.ok(bytes.byteLength>100_000);
  assert.equal(pdf.getTitle(),'实验回归评测报告');
});
