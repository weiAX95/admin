import { useEffect, useMemo, useRef, useState } from 'react';
import { Card, Col, Empty, Row, Select, Typography } from 'antd';
import { Chart, ArcElement, BarElement, CategoryScale, LinearScale, RadialLinearScale, PointElement, LineElement, Tooltip, Legend, PieController, BarController, RadarController } from 'chart.js';
import type { RegressionReport } from '../api/experiment-evaluation';

Chart.register(ArcElement,BarElement,CategoryScale,LinearScale,RadialLinearScale,PointElement,LineElement,Tooltip,Legend,PieController,BarController,RadarController);
export type ReportDrill = { field: 'status' | 'score' | 'category' | 'variantId'; value: string | number } | { field: 'metric'; value: { name: string; min: number; max: number; last: boolean } } | null;
const colors = ['#9582ff','#7dcca4','#e6bb77','#ec929f','#72b9dd','#c89ae5'];

function useChart(canvas: React.RefObject<HTMLCanvasElement>, build: () => Chart | undefined, deps: unknown[]) {
  useEffect(() => { if (!canvas.current) return; const chart=build(); return () => chart?.destroy(); }, deps);
}

export default function EvaluationReportCharts({ report, onDrill }: { report: RegressionReport; onDrill: (value: ReportDrill) => void }) {
  const pie=useRef<HTMLCanvasElement>(null),hist=useRef<HTMLCanvasElement>(null),radar=useRef<HTMLCanvasElement>(null),metricChart=useRef<HTMLCanvasElement>(null);
  const [selectedMetric,setSelectedMetric]=useState('');
  const metrics=useMemo(()=>{
    const values=new Map<string,number[]>();
    for(const item of report.cases) for(const [name,value] of Object.entries(item.metricDetails || {})) {
      if(typeof value==='number' && Number.isFinite(value)) { if(!values.has(name)) values.set(name,[]); values.get(name)!.push(value); }
    }
    return [...values].sort(([left],[right])=>left.localeCompare(right));
  },[report.cases]);
  const activeMetric=metrics.find(([name])=>name===selectedMetric)||metrics[0];
  const metricBins=useMemo(()=>{
    if(!activeMetric)return [];
    const values=activeMetric[1],min=Math.min(...values),max=Math.max(...values),step=(max-min||1)/5;
    return Array.from({length:5},(_,index)=>{
      const low=min+index*step,high=min+(index+1)*step;
      return {min:low,max:high,last:index===4,label:`${low.toFixed(2)}–${high.toFixed(2)}`,count:values.filter(value=>value>=low&&(index===4?value<=high:value<high)).length};
    });
  },[activeMetric]);
  const variants=useMemo(() => {
    const map=new Map<string,{ label:string; values:[number[],number[],number[]] }>();
    for(const item of report.cases) {
      const entry=map.get(item.variantId)||{label:item.variantLabel||item.variantId.slice(0,8),values:[[],[],[]]};
      ([item.score,item.ruleScore,item.judgeScore] as (number|null)[]).forEach((value,index)=>{if(value!==null&&Number.isFinite(value))entry.values[index].push(value);});
      map.set(item.variantId,entry);
    }
    return [...map].map(([id,item])=>({id,label:item.label,scores:item.values.map(values=>values.length?values.reduce((sum,value)=>sum+value,0)/values.length:0)}));
  },[report.cases]);
  useChart(pie,()=>new Chart(pie.current!,{type:'pie',data:{labels:['通过','未通过','失败','未评分'],datasets:[{data:[report.statusDistribution.passed||0,report.statusDistribution.belowThreshold||0,report.statusDistribution.failed||0,report.statusDistribution.unscored||0],backgroundColor:colors.slice(0,4)}]},options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{labels:{color:'#c5c9d8'}}},onClick:(_event,elements)=>{const index=elements[0]?.index;if(index!==undefined)onDrill({field:'status',value:['passed','below','failed','unscored'][index]});}}}),[report,onDrill]);
  useChart(hist,()=>new Chart(hist.current!,{type:'bar',data:{labels:report.histogram.map(item=>item.range),datasets:[{label:'用例数',data:report.histogram.map(item=>item.count),backgroundColor:'#9582ff'}]},options:{responsive:true,maintainAspectRatio:false,scales:{x:{ticks:{color:'#b8bfd1'}},y:{beginAtZero:true,ticks:{color:'#b8bfd1',precision:0}}},plugins:{legend:{display:false}},onClick:(_event,elements)=>{const index=elements[0]?.index;if(index!==undefined)onDrill({field:'score',value:index});}}}),[report,onDrill]);
  useChart(metricChart,()=>activeMetric?new Chart(metricChart.current!,{type:'bar',data:{labels:metricBins.map(item=>item.label),datasets:[{label:'用例数',data:metricBins.map(item=>item.count),backgroundColor:'#72b9dd'}]},options:{responsive:true,maintainAspectRatio:false,scales:{x:{ticks:{color:'#b8bfd1'}},y:{beginAtZero:true,ticks:{color:'#b8bfd1',precision:0}}},plugins:{legend:{display:false}},onClick:(_event,elements)=>{const index=elements[0]?.index;if(index!==undefined)onDrill({field:'metric',value:{name:activeMetric[0],...metricBins[index]}});}}}):undefined,[activeMetric,metricBins,onDrill]);
  useChart(radar,()=>new Chart(radar.current!,{type:'radar',data:{labels:['综合评分','规则评分','Judge 评分'],datasets:variants.slice(0,8).map((item,index)=>({label:item.label,data:item.scores,borderColor:colors[index%colors.length],backgroundColor:`${colors[index%colors.length]}22`,pointBackgroundColor:colors[index%colors.length]}))},options:{responsive:true,maintainAspectRatio:false,scales:{r:{min:0,max:5,ticks:{stepSize:1,color:'#b8bfd1',backdropColor:'transparent'},pointLabels:{color:'#c5c9d8'},grid:{color:'#394058'}}},plugins:{legend:{labels:{color:'#c5c9d8'}}},onClick:(_event,elements)=>{const index=elements[0]?.datasetIndex;if(index!==undefined)onDrill({field:'variantId',value:variants[index].id});}}}),[variants,onDrill]);
  const categories=report.byCategory.filter(item=>item.count>0);
  const total=categories.reduce((sum,item)=>sum+item.count,0);
  return <Row gutter={[16,16]} style={{marginTop:24}}>
    <Col xs={24} lg={12}><Card size="small" title="通过／失败分布"><div style={{height:260}}><canvas ref={pie} aria-label="通过与失败分布饼图" role="img" /></div></Card></Col>
    <Col xs={24} lg={12}><Card size="small" title="综合评分直方图"><div style={{height:260}}><canvas ref={hist} aria-label="评分分布直方图" role="img" /></div></Card></Col>
    <Col xs={24} lg={12}><Card size="small" title="逐指标分布" extra={<Select aria-label="选择评测指标" style={{minWidth:150}} value={activeMetric?.[0]} onChange={setSelectedMetric} options={metrics.map(([name])=>({value:name,label:name}))} />}>{activeMetric?<div style={{height:260}}><canvas ref={metricChart} aria-label={`${activeMetric[0]} 分布直方图`} role="img" /></div>:<Empty description="暂无逐指标数据" />}</Card></Col>
    <Col xs={24} lg={12}><Card size="small" title="模型变体对比雷达图">{variants.length?<div style={{height:270}}><canvas ref={radar} aria-label="模型变体的综合、规则与 Judge 评分雷达图" role="img" /></div>:<Empty description="暂无可比变体" />}</Card></Col>
    <Col xs={24} lg={12}><Card size="small" title="失败用例分类树图"><Typography.Paragraph type="secondary">点击分类筛选下方明细；面积按用例数量划分。</Typography.Paragraph>{total?<div style={{display:'flex',flexWrap:'wrap',height:220,gap:4}}>{categories.map((item,index)=><button key={item.name} type="button" title={`${item.name}：${item.count} 条，通过率 ${item.passRate===null?'暂无数据':`${(item.passRate*100).toFixed(1)}%`}`} onClick={()=>onDrill({field:'category',value:item.name})} style={{flex:`${Math.max(1,item.count)} 0 ${Math.max(15,item.count/total*90)}%`,border:0,borderRadius:6,background:colors[index%colors.length],color:'#11131f',cursor:'pointer',minHeight:40,fontWeight:600}}>{item.name} · {item.count}</button>)}</div>:<Empty description="暂无分类数据" />}</Card></Col>
  </Row>;
}
