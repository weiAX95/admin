import { isAdministrator } from '../utils/roles';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, App, Button, Card, Col, Input, Modal, Progress, Row, Select, Space, Spin, Table, Tag, Typography } from 'antd';
import { Link, useParams } from 'react-router-dom';
import { createEvaluationReportShare, getJudgeQuality, getRegressionDegradedMetrics, getRegressionReport, getRegressionReportCases, getRegressionReportSummary, listEvaluationReportShares, previewEvaluationReportShare, revokeEvaluationReportShare } from '../api/experiment-evaluation';
import type { DegradedMetric, RegressionCase, RegressionReport } from '../api/experiment-evaluation';
import type { JudgeQuality } from '../api/experiment-evaluation';
import { getStoredUser } from '../api/client';
import { downloadBlob } from '../utils/noteExport';
import EvaluationReportCharts from '../components/EvaluationReportCharts';
import type { ReportDrill } from '../components/EvaluationReportCharts';
import { downloadDegradedCsv } from '../utils/evaluationRegressionCsv';
import { getBatchProgress } from '../api/experiment-platform';

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
  const { message, modal } = App.useApp();
  const { id } = useParams();
  const [report, setReport] = useState<RegressionReport | null>(null);
  const [progress, setProgress] = useState<{status:string;totalRuns:number;finishedRuns:number;failedRuns:number} | null>(null);
  const [error, setError] = useState('');
  const [downloading, setDownloading] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const [sharePreview, setSharePreview] = useState<RegressionReport | null>(null);
  const [sharePreviewPage, setSharePreviewPage] = useState(1);
  const [sharePreviewLoading, setSharePreviewLoading] = useState(false);
  const sharePreviewRequest = useRef(0);
  const [shareExpiry, setShareExpiry] = useState<'1h'|'24h'|'7d'|'permanent'>('24h');
  const [shareUrl, setShareUrl] = useState('');
  const [shares, setShares] = useState<{ id: string; revoked_at: string | null; expires_at: string | null }[]>([]);
  const [drill, setDrill] = useState<ReportDrill>(null);
  const [judgeQuality, setJudgeQuality] = useState<JudgeQuality | null>(null);
  const [casePage, setCasePage] = useState(1);
  const [casePageSize, setCasePageSize] = useState(50);
  const [caseRows, setCaseRows] = useState<RegressionCase[]>([]);
  const [caseTotal, setCaseTotal] = useState(0);
  const [caseLoading, setCaseLoading] = useState(false);
  const [caseError, setCaseError] = useState('');
  const caseRequest = useRef(0);
  const [degradedPage, setDegradedPage] = useState(1);
  const [degradedRows, setDegradedRows] = useState<DegradedMetric[]>([]);
  const [degradedLoading, setDegradedLoading] = useState(false);
  const [degradedError, setDegradedError] = useState('');
  const degradedRequest = useRef(0);
  const selectDrill = useCallback((value: ReportDrill) => { setDrill(value); setCasePage(1); }, []);
  const load = useCallback(async () => {
    try {
      const current=await getBatchProgress(id || '');
      setProgress(current);
      if (!['queued','running'].includes(current.status)) setReport(await getRegressionReportSummary(id || ''));
      setError('');
    } catch (cause) { setError(cause instanceof Error ? cause.message : '报告加载失败'); }
  }, [id]);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => { if (!progress || !['queued','running'].includes(progress.status)) return; const timer=window.setInterval(()=>{if(!document.hidden) void load();},2000);return ()=>window.clearInterval(timer); }, [progress?.status,load]);
  useEffect(() => { if (!report || !isAdministrator(getStoredUser<{role:string}>())) return; void getJudgeQuality(report.datasetVersionId,report.metricVersionId).then(setJudgeQuality).catch(()=>setJudgeQuality(null)); }, [report?.datasetVersionId,report?.metricVersionId]);
  useEffect(() => {
    if (!report || !id) return;
    const request = ++caseRequest.current;
    setCaseLoading(true);
    setCaseError('');
    void getRegressionReportCases(id, casePage, casePageSize, drill).then(value => {
      if (request !== caseRequest.current) return;
      setCaseRows(value.items); setCaseTotal(value.total);
    }).catch(cause => { if (request === caseRequest.current) setCaseError(cause instanceof Error ? cause.message : '用例加载失败'); }).finally(() => { if (request === caseRequest.current) setCaseLoading(false); });
    return () => { caseRequest.current++; };
  }, [report, id, casePage, casePageSize, drill]);
  useEffect(() => {
    if (!report || !id || report.kind !== 'regression') return;
    const request = ++degradedRequest.current;
    setDegradedLoading(true);
    setDegradedError('');
    void getRegressionDegradedMetrics(id, degradedPage, 50).then(value => { if (request === degradedRequest.current) setDegradedRows(value.items); }).catch(cause => { if (request === degradedRequest.current) setDegradedError(cause instanceof Error ? cause.message : '退化用例加载失败'); }).finally(() => { if (request === degradedRequest.current) setDegradedLoading(false); });
    return () => { degradedRequest.current++; };
  }, [report, id, degradedPage]);
  if (error) return <Alert type="error" showIcon message={error} action={<Button onClick={() => void load()}>重试</Button>} />;
  if (!report) return progress ? <Card title="评测运行中"><Tag>{progress.status}</Tag><Progress percent={progress.totalRuns?Math.round(progress.finishedRuns/progress.totalRuns*100):0} format={()=>`${progress.finishedRuns}/${progress.totalRuns}`} /><Typography.Text type="secondary">失败 {progress.failedRuns} 条；完成后自动加载完整报告。</Typography.Text></Card> : <Spin />;
  const isRegression = report.kind === 'regression';
  const exportPdf = async () => { setDownloading(true); try { const [{ makeRegressionPdf }, complete] = await Promise.all([import('../utils/experimentReportPdf'), getRegressionReport(report.batchId)]); downloadBlob(await makeRegressionPdf(complete), `实验${isRegression ? '回归' : '数据集'}报告-${report.batchId.slice(0,8)}.pdf`); } catch (cause) { message.error(cause instanceof Error ? cause.message : 'PDF 生成失败'); } finally { setDownloading(false); } };
  const openShare = async () => { try { const [preview, existing] = await Promise.all([previewEvaluationReportShare(report.batchId), listEvaluationReportShares(report.batchId)]); setSharePreview(preview); setSharePreviewPage(1); setShares(existing.items); setShareUrl(''); setShareOpen(true); } catch (cause) { message.error(cause instanceof Error ? cause.message : '分享预览失败'); } };
  const loadSharePreviewPage = async (page: number) => { const request = ++sharePreviewRequest.current; setSharePreviewLoading(true); try { const preview = await previewEvaluationReportShare(report.batchId, page); if (request === sharePreviewRequest.current) { setSharePreview(preview); setSharePreviewPage(page); } } catch (cause) { if (request === sharePreviewRequest.current) message.error(cause instanceof Error ? cause.message : '分享预览失败'); } finally { if (request === sharePreviewRequest.current) setSharePreviewLoading(false); } };
  const createShare = async () => { try { const value = await createEvaluationReportShare(report.batchId,shareExpiry); setShareUrl(new URL(value.path,location.origin).href); setShares((await listEvaluationReportShares(report.batchId)).items); message.success('只读链接已创建'); } catch (cause) { message.error(cause instanceof Error ? cause.message : '分享失败'); } };
  const revokeShare = (shareId: string) => modal.confirm({ title: '撤销报告分享？', onOk: async () => { await revokeEvaluationReportShare(shareId); setShares((await listEvaluationReportShares(report.batchId)).items); message.success('已撤销'); } });
  const exportDegraded = async () => { try { const complete = await getRegressionReport(report.batchId); downloadDegradedCsv(complete.degradedMetrics,`退化用例-${report.batchId.slice(0,8)}.csv`); } catch (cause) { message.error(cause instanceof Error ? cause.message : '退化用例导出失败'); } };
  return <Card title={isRegression ? '回归评测报告' : '数据集评测报告'} extra={<Space><Link to="/experiments">返回实验</Link><Button onClick={() => void openShare()}>分享报告</Button><Button loading={downloading} onClick={() => void exportPdf()}>导出 PDF</Button></Space>}>
    <Typography.Paragraph type="secondary">数据集版本 {report.datasetVersionId} · 指标版本 {report.metricVersionId}{isRegression && ` · baseline ${report.baselineBatchId}`}</Typography.Paragraph>
    <Row gutter={16}><Col xs={12} md={6}><Card size="small" title="通过率">{report.passRate === null ? '暂无数据' : `${(report.passRate*100).toFixed(1)}%`}</Card></Col><Col xs={12} md={6}><Card size="small" title="有效评分">{report.scored} / {report.total}</Card></Col><Col xs={12} md={6}><Card size="small" title={isRegression ? '退化用例' : '失败用例'}>{isRegression ? report.degradedCount : report.statusDistribution.failed || 0}</Card></Col><Col xs={12} md={6}><Card size="small" title="状态"><Tag>{report.status}</Tag></Card></Col></Row>
    <Typography.Title level={5} style={{ marginTop: 28 }}>评分分布</Typography.Title><BoxPlot values={report.box} />
    {judgeQuality && <Card size="small" title="Judge 与人工评分相关性" style={{marginTop:16}}><Typography.Paragraph>匹配用例 {judgeQuality.count} 条 · 综合 Pearson r：{judgeQuality.overallPearson ?? '暂无数据'} {judgeQuality.thresholdMet===true?<Tag color="green">超过 0.7</Tag>:judgeQuality.thresholdMet===false?<Tag color="warning">未达到 0.7</Tag>:null}</Typography.Paragraph><Space wrap>{Object.entries(judgeQuality.dimensions).map(([name,value])=><Tag key={name}>{name}: {value.pearson ?? '暂无数据'} ({value.count})</Tag>)}</Space></Card>}
    <EvaluationReportCharts report={report} onDrill={selectDrill} />
    <Row gutter={16} style={{ marginTop: 24 }}><Col xs={24} md={12}><Table title={() => '按难度'} size="small" rowKey="name" pagination={false} dataSource={report.byDifficulty} columns={[{title:'难度',dataIndex:'name'},{title:'用例',dataIndex:'count'},{title:'通过率',dataIndex:'passRate',render:value=>value===null?'—':`${(value*100).toFixed(1)}%`}]}/></Col><Col xs={24} md={12}><Table title={() => '按分类'} size="small" rowKey="name" pagination={false} dataSource={report.byCategory} columns={[{title:'分类',dataIndex:'name'},{title:'用例',dataIndex:'count'},{title:'通过率',dataIndex:'passRate',render:value=>value===null?'—':`${(value*100).toFixed(1)}%`}]}/></Col></Row>
    {isRegression && <><Typography.Title level={5}>退化用例（归一化下降超过 {report.normalizedRegressionThreshold}） <Button size="small" disabled={!report.degradedMetricCount} onClick={() => void exportDegraded()}>导出 CSV</Button></Typography.Title>{degradedError && <Alert type="error" showIcon message={degradedError} style={{marginBottom:12}} />}<Table rowKey={row=>`${row.caseKey}-${row.metric}`} size="small" loading={degradedLoading} dataSource={degradedRows} pagination={{current:degradedPage,pageSize:50,total:report.degradedMetricCount,onChange:setDegradedPage}} columns={[{title:'用例 ID',dataIndex:'caseKey'},{title:'指标',dataIndex:'metric'},{title:'基线',dataIndex:'baseline'},{title:'当前',dataIndex:'current'},{title:'下降',dataIndex:'drop',render:value=><Tag color="error">{value}</Tag>},{title:'影响通过率',dataIndex:'affectedPassRate',render:value=>value?'是':'否'},{title:'难度',dataIndex:'difficulty'},{title:'分类',dataIndex:'category'}]} /></>}
    <Typography.Title level={5}>{isRegression ? '逐用例对比' : '逐用例结果'} {drill && <Button size="small" onClick={() => selectDrill(null)}>清除图表筛选（{caseTotal} 条）</Button>}</Typography.Title>{caseError && <Alert type="error" showIcon message={caseError} style={{marginBottom:12}} />}<Table rowKey={row=>`${row.caseKey}-${row.variantId}`} size="small" loading={caseLoading} dataSource={caseRows} pagination={{current:casePage,pageSize:casePageSize,total:caseTotal,showSizeChanger:true,pageSizeOptions:[10,20,50,100],onChange:(page,size)=>{setCasePage(page);setCasePageSize(size);}}} columns={[{title:'用例 ID',dataIndex:'caseKey'},...(isRegression ? [{title:'基线',dataIndex:'baselineScore',render:(value: number | null)=>value??'—'}] : []),{title:'当前',dataIndex:'score',render:value=>value??'—'},{title:'规则分',dataIndex:'ruleScore',render:value=>value??'—'},{title:'Judge 分',dataIndex:'judgeScore',render:value=>value??'—'},{title:'是否通过',dataIndex:'passed',render:value=>value===null?'—':value?'通过':'未通过'}]} />
    <Modal title="公开只读报告" open={shareOpen} onCancel={() => setShareOpen(false)} onOk={() => { modal.confirm({ title: '确认公开此报告？', content: '链接持有人可以查看输入、上下文、参考答案、输出及报告媒体。重试更新同一批次后，链接也会显示更新结果。', onOk: createShare }); }} okText="创建链接">
      <Alert type="warning" showIcon message="公开范围" description="完整输入、对话上下文、参考答案、模型输出和报告媒体均会向链接持有人开放。" />
      <Typography.Paragraph style={{ marginTop: 12 }}>报告 {sharePreview?.batchId} · {sharePreview?.total} 条用例 · 当前状态 {sharePreview?.status} · 逐页核对公开内容</Typography.Paragraph>
      <Table size="small" rowKey={row => `${row.caseKey}-${row.variantId}`} loading={sharePreviewLoading} pagination={{ current: sharePreviewPage, pageSize: 3, total: sharePreview?.total || 0, onChange: page => { void loadSharePreviewPage(page); } }} dataSource={sharePreview?.cases || []} columns={[{ title: '用例', dataIndex: 'caseKey' }, { title: '输入', dataIndex: 'input', render: value => <Typography.Text ellipsis style={{ maxWidth: 150 }}>{JSON.stringify(value)}</Typography.Text> }, { title: '上下文', dataIndex: 'context', render: value => <Typography.Text ellipsis style={{ maxWidth: 100 }}>{JSON.stringify(value)}</Typography.Text> }, { title: '参考答案', dataIndex: 'expectedOutput', render: value => <Typography.Text ellipsis style={{ maxWidth: 100 }}>{JSON.stringify(value)}</Typography.Text> }, { title: '输出', dataIndex: 'output', render: value => <Typography.Text ellipsis style={{ maxWidth: 120 }}>{value}</Typography.Text> }]} />
      <Space style={{ marginTop: 12 }}><span>有效期</span><Select value={shareExpiry} onChange={setShareExpiry} style={{ width: 120 }} options={[{value:'1h',label:'1 小时'},{value:'24h',label:'24 小时'},{value:'7d',label:'7 天'},{value:'permanent',label:'永久'}]} /></Space>
      {shareUrl && <Input readOnly value={shareUrl} onFocus={event => event.target.select()} style={{ marginTop: 12 }} />}
      {shares.filter(item => !item.revoked_at).map(item => <div key={item.id} style={{ marginTop: 8 }}><Space><Typography.Text>分享 {item.id.slice(0,8)} · {item.expires_at ? new Date(item.expires_at).toLocaleString() : '永久'}</Typography.Text><Button danger size="small" onClick={() => revokeShare(item.id)}>撤销</Button></Space></div>)}
    </Modal>
  </Card>;
}
