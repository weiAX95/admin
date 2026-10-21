import { useEffect, useRef, useState } from 'react';
import { Card, Col, Empty, Row, Select, Typography, theme } from 'antd';
import { Chart, ArcElement, BarElement, CategoryScale, LinearScale, RadialLinearScale, PointElement, LineElement, Tooltip, Legend, PieController, BarController, RadarController } from 'chart.js';
import type { RegressionReport, ReportDrill } from '../api/experiment-evaluation';

Chart.register(ArcElement,BarElement,CategoryScale,LinearScale,RadialLinearScale,PointElement,LineElement,Tooltip,Legend,PieController,BarController,RadarController);
export type { ReportDrill } from '../api/experiment-evaluation';

function useChart(canvas: React.RefObject<HTMLCanvasElement>, build: () => Chart | undefined, deps: unknown[]) {
  useEffect(() => { if (!canvas.current) return; const chart=build(); return () => chart?.destroy(); }, deps);
}

export default function EvaluationReportCharts({ report, onDrill }: { report: RegressionReport; onDrill: (value: ReportDrill) => void }) {
  const { token } = theme.useToken();
  const colors = [token.colorPrimary, token.colorSuccess, token.colorWarning, token.colorError, token.colorInfo, token.colorLink];
  const pie=useRef<HTMLCanvasElement>(null),hist=useRef<HTMLCanvasElement>(null),radar=useRef<HTMLCanvasElement>(null),metricChart=useRef<HTMLCanvasElement>(null);
  const [selectedMetric,setSelectedMetric]=useState('');
  const metrics = report.chartData?.metrics || [];
  const activeMetric = metrics.find(item => item.name === selectedMetric) || metrics[0];
  const metricBins = activeMetric?.bins || [];
  const variants = report.chartData?.variants || [];
  useChart(pie,()=>new Chart(pie.current!,{type:'pie',data:{labels:['通过','未通过','失败','未评分'],datasets:[{data:[report.statusDistribution.passed||0,report.statusDistribution.belowThreshold||0,report.statusDistribution.failed||0,report.statusDistribution.unscored||0],backgroundColor:colors.slice(0,4)}]},options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{labels:{color:token.colorTextSecondary}}},onClick:(_event,elements)=>{const index=elements[0]?.index;if(index!==undefined)onDrill({field:'status',value:['passed','below','failed','unscored'][index]});}}}),[report,onDrill,token.colorPrimary,token.colorSuccess,token.colorWarning,token.colorError,token.colorTextSecondary]);
  useChart(hist,()=>new Chart(hist.current!,{type:'bar',data:{labels:report.histogram.map(item=>item.range),datasets:[{label:'用例数',data:report.histogram.map(item=>item.count),backgroundColor:token.colorPrimary}]},options:{responsive:true,maintainAspectRatio:false,scales:{x:{ticks:{color:token.colorTextSecondary}},y:{beginAtZero:true,ticks:{color:token.colorTextSecondary,precision:0}}},plugins:{legend:{display:false}},onClick:(_event,elements)=>{const index=elements[0]?.index;if(index!==undefined)onDrill({field:'score',value:index});}}}),[report,onDrill,token.colorPrimary,token.colorTextSecondary]);
  useChart(metricChart,()=>activeMetric?new Chart(metricChart.current!,{type:'bar',data:{labels:metricBins.map(item=>item.label),datasets:[{label:'用例数',data:metricBins.map(item=>item.count),backgroundColor:token.colorInfo}]},options:{responsive:true,maintainAspectRatio:false,scales:{x:{ticks:{color:token.colorTextSecondary}},y:{beginAtZero:true,ticks:{color:token.colorTextSecondary,precision:0}}},plugins:{legend:{display:false}},onClick:(_event,elements)=>{const index=elements[0]?.index;if(index!==undefined)onDrill({field:'metric',value:{name:activeMetric.name,...metricBins[index]}});}}}):undefined,[activeMetric,metricBins,onDrill,token.colorInfo,token.colorTextSecondary]);
  useChart(radar,()=>new Chart(radar.current!,{type:'radar',data:{labels:['综合评分','规则评分','Judge 评分'],datasets:variants.slice(0,8).map((item,index)=>({label:item.label,data:item.scores,borderColor:colors[index%colors.length],backgroundColor:`${colors[index%colors.length]}22`,pointBackgroundColor:colors[index%colors.length]}))},options:{responsive:true,maintainAspectRatio:false,scales:{r:{min:0,max:5,ticks:{stepSize:1,color:token.colorTextSecondary,backdropColor:'transparent'},pointLabels:{color:token.colorTextSecondary},grid:{color:token.colorSplit}}},plugins:{legend:{labels:{color:token.colorTextSecondary}}},onClick:(_event,elements)=>{const index=elements[0]?.datasetIndex;if(index!==undefined)onDrill({field:'variantId',value:variants[index].id});}}}),[variants,onDrill,...colors,token.colorTextSecondary,token.colorSplit]);
  const categories=report.byCategory.filter(item=>item.count>0);
  const total=categories.reduce((sum,item)=>sum+item.count,0);
  return <Row gutter={[16,16]} style={{marginTop:24}}>
    <Col xs={24} lg={12}><Card size="small" title="通过／失败分布"><div style={{height:260}}><canvas ref={pie} aria-label="通过与失败分布饼图" role="img" /></div></Card></Col>
    <Col xs={24} lg={12}><Card size="small" title="综合评分直方图"><div style={{height:260}}><canvas ref={hist} aria-label="评分分布直方图" role="img" /></div></Card></Col>
    <Col xs={24} lg={12}><Card size="small" title="逐指标分布" extra={<Select aria-label="选择评测指标" style={{minWidth:150}} value={activeMetric?.name} onChange={setSelectedMetric} options={metrics.map(item=>({value:item.name,label:item.name}))} />}>{activeMetric?<div style={{height:260}}><canvas ref={metricChart} aria-label={`${activeMetric.name} 分布直方图`} role="img" /></div>:<Empty description="暂无逐指标数据" />}</Card></Col>
    <Col xs={24} lg={12}><Card size="small" title="模型变体对比雷达图">{variants.length?<div style={{height:270}}><canvas ref={radar} aria-label="模型变体的综合、规则与 Judge 评分雷达图" role="img" /></div>:<Empty description="暂无可比变体" />}</Card></Col>
    <Col xs={24} lg={12}><Card size="small" title="失败用例分类树图"><Typography.Paragraph type="secondary">点击分类筛选下方明细；面积按用例数量划分。</Typography.Paragraph>{total?<div style={{display:'flex',flexWrap:'wrap',height:220,gap:4}}>{categories.map((item,index)=><button key={item.name} type="button" title={`${item.name}：${item.count} 条，通过率 ${item.passRate===null?'暂无数据':`${(item.passRate*100).toFixed(1)}%`}`} onClick={()=>onDrill({field:'category',value:item.name})} style={{flex:`${Math.max(1,item.count)} 0 ${Math.max(15,item.count/total*90)}%`,border:0,borderRadius:6,background:colors[index%colors.length],color:'#11131f',cursor:'pointer',minHeight:40,fontWeight:600}}>{item.name} · {item.count}</button>)}</div>:<Empty description="暂无分类数据" />}</Card></Col>
  </Row>;
}
