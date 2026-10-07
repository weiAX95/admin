import { useCallback, useEffect, useState } from 'react';
import { Alert, Button, Card, Col, Row, Spin, Table, Tag, Typography } from 'antd';
import { Link, useParams } from 'react-router-dom';
import { getRegressionReport } from '../api/experiment-evaluation';
import type { RegressionReport } from '../api/experiment-evaluation';
import { downloadBlob } from '../utils/noteExport';

function BoxPlot({ values }: { values: RegressionReport['box'] }) {
  if (!values) return <Typography.Text type="secondary">暂无有效评分</Typography.Text>;
  const x = (value: number) => 45 + value * 100;
  return <svg viewBox="0 0 590 100" role="img" aria-label={`评分箱线图：最小 ${values.min}、下四分位 ${values.q1}、中位 ${values.median}、上四分位 ${values.q3}、最大 ${values.max}`} style={{ width: '100%', maxWidth: 590 }}>
    <line x1="45" y1="70" x2="545" y2="70" stroke="#8a91aa" />
    {[0,1,2,3,4,5].map(tick => <g key={tick}><line x1={x(tick)} y1="67" x2={x(tick)} y2="73" stroke="#8a91aa" /><text x={x(tick)} y="90" textAnchor="middle" fill="#aeb6cc" fontSize="12">{tick}</text></g>)}
    <line x1={x(values.min)} y1="35" x2={x(values.max)} y2="35" stroke="#9582ff" strokeWidth="2" />
    <rect x={x(values.q1)} y="20" width={Math.max(2, x(values.q3)-x(values.q1))} height="30" fill="#514586" stroke="#b9aafc" />
    <line x1={x(values.median)} y1="20" x2={x(values.median)} y2="50" stroke="#e6bb77" strokeWidth="3" />
    {[values.min, values.max].map((value,index)=><line key={index} x1={x(value)} y1="27" x2={x(value)} y2="43" stroke="#b9aafc" />)}
  </svg>;
}

export default function ExperimentRegressionReport() {
  const { id } = useParams();
  const [report, setReport] = useState<RegressionReport | null>(null);
  const [error, setError] = useState('');
  const [downloading, setDownloading] = useState(false);
  const load = useCallback(() => getRegressionReport(id || '').then(value => { setReport(value); setError(''); }).catch(cause => setError(cause instanceof Error ? cause.message : '报告加载失败')), [id]);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => { if (!report || !['queued','running'].includes(report.status)) return; const timer=window.setInterval(()=>{if(!document.hidden) void load();},2000);return ()=>window.clearInterval(timer); }, [report,load]);
  if (error) return <Alert type="error" showIcon message={error} action={<Button onClick={() => void load()}>重试</Button>} />;
  if (!report) return <Spin />;
  const exportPdf = async () => { setDownloading(true); try { const { makeRegressionPdf } = await import('../utils/experimentReportPdf'); downloadBlob(await makeRegressionPdf(report), `实验回归报告-${report.batchId.slice(0,8)}.pdf`); } catch (cause) { setError(cause instanceof Error ? cause.message : 'PDF 生成失败'); } finally { setDownloading(false); } };
  return <Card title="回归评测报告" extra={<><Link to="/experiments">返回实验</Link><Button style={{ marginLeft: 12 }} loading={downloading} onClick={() => void exportPdf()}>导出 PDF</Button></>}>
    <Typography.Paragraph type="secondary">数据集版本 {report.datasetVersionId} · 指标版本 {report.metricVersionId} · baseline {report.baselineBatchId}</Typography.Paragraph>
    <Row gutter={16}><Col xs={12} md={6}><Card size="small" title="通过率">{report.passRate === null ? '暂无数据' : `${(report.passRate*100).toFixed(1)}%`}</Card></Col><Col xs={12} md={6}><Card size="small" title="有效评分">{report.scored} / {report.total}</Card></Col><Col xs={12} md={6}><Card size="small" title="退化用例">{report.degraded.length}</Card></Col><Col xs={12} md={6}><Card size="small" title="状态"><Tag>{report.status}</Tag></Card></Col></Row>
    <Typography.Title level={5} style={{ marginTop: 28 }}>评分分布</Typography.Title><BoxPlot values={report.box} />
    <Row gutter={16} style={{ marginTop: 24 }}><Col xs={24} md={12}><Table title={() => '按难度'} size="small" rowKey="name" pagination={false} dataSource={report.byDifficulty} columns={[{title:'难度',dataIndex:'name'},{title:'用例',dataIndex:'count'},{title:'通过率',dataIndex:'passRate',render:value=>value===null?'—':`${(value*100).toFixed(1)}%`}]}/></Col><Col xs={24} md={12}><Table title={() => '按分类'} size="small" rowKey="name" pagination={false} dataSource={report.byCategory} columns={[{title:'分类',dataIndex:'name'},{title:'用例',dataIndex:'count'},{title:'通过率',dataIndex:'passRate',render:value=>value===null?'—':`${(value*100).toFixed(1)}%`}]}/></Col></Row>
    <Typography.Title level={5}>退化用例（下降超过 {report.regressionThreshold} 分）</Typography.Title><Table rowKey={row=>`${row.caseKey}-${row.category}`} size="small" dataSource={report.degraded} columns={[{title:'用例 ID',dataIndex:'caseKey'},{title:'基线',dataIndex:'baselineScore'},{title:'当前',dataIndex:'score'},{title:'差值',dataIndex:'delta',render:value=><Tag color="error">{value}</Tag>},{title:'难度',dataIndex:'difficulty'},{title:'分类',dataIndex:'category'}]} />
    <Typography.Title level={5}>逐用例对比</Typography.Title><Table rowKey={row=>`${row.caseKey}-${row.variantId}`} size="small" dataSource={report.cases} columns={[{title:'用例 ID',dataIndex:'caseKey'},{title:'基线',dataIndex:'baselineScore'},{title:'当前',dataIndex:'score',render:value=>value??'—'},{title:'规则分',dataIndex:'ruleScore',render:value=>value??'—'},{title:'Judge 分',dataIndex:'judgeScore',render:value=>value??'—'},{title:'是否通过',dataIndex:'passed',render:value=>value===null?'—':value?'通过':'未通过'}]} />
  </Card>;
}
