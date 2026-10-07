import { useEffect, useRef, useState } from 'react';
import { Alert, Card, Space, Spin, Table } from 'antd';
import Chart from 'chart.js/auto';
import { Link, useParams } from 'react-router-dom';
import { getChain } from '../api/experiment-evaluation';

type Chain = Awaited<ReturnType<typeof getChain>>;
export default function ExperimentChain() {
  const { id } = useParams();
  const [chain, setChain] = useState<Chain | null>(null);
  const [error, setError] = useState('');
  const canvas = useRef<HTMLCanvasElement>(null);
  useEffect(() => { let alive=true; void getChain(id || '').then(value => { if(alive)setChain(value); }).catch(cause=>{if(alive)setError(cause instanceof Error?cause.message:'加载失败');});return()=>{alive=false;};},[id]);
  useEffect(() => {
    if(!canvas.current || !chain) return;
    const labels=chain.items.map(item=>new Date(item.created_at).toLocaleDateString('zh-CN'));
    const chart=new Chart(canvas.current,{type:'line',data:{labels,datasets:[{label:'自动评分',data:chain.items.map(item=>item.score),borderColor:'#9582ff',yAxisID:'score',spanGaps:true},{label:'延迟 ms',data:chain.items.map(item=>item.latency_ms),borderColor:'#67c7d5',yAxisID:'latency',spanGaps:true},{label:'成本 USD',data:chain.items.map(item=>item.cost_usd),borderColor:'#e6bb77',yAxisID:'cost',spanGaps:true}]},options:{responsive:true,plugins:{legend:{labels:{color:'#cbd1e3'}}},scales:{x:{ticks:{color:'#cbd1e3'}},score:{type:'linear',position:'left',min:0,max:5,ticks:{color:'#9582ff'}},latency:{type:'linear',position:'right',ticks:{color:'#67c7d5'},grid:{drawOnChartArea:false}},cost:{type:'linear',position:'right',display:false}}}});
    return()=>chart.destroy();
  },[chain]);
  if(error)return <Alert type="error" showIcon message={error}/>;
  if(!chain)return <Spin/>;
  return <Card title={`版本链：${chain.title}`} extra={<Link to="/experiments">返回实验列表</Link>}><div style={{maxWidth:900}}><canvas ref={canvas} role="img" aria-label="实验版本评分、延迟与成本变化折线图"/></div><Table rowKey="id" style={{marginTop:24}} dataSource={chain.items} columns={[{title:'版本',dataIndex:'title',render:(value,row)=><Link to={`/experiments/${row.id}`}>{value}</Link>},{title:'创建时间',dataIndex:'created_at',render:value=>new Date(value).toLocaleString('zh-CN')},{title:'平均评分',dataIndex:'score',render:value=>value===null?'暂无数据':Number(value).toFixed(2)},{title:'平均延迟',dataIndex:'latency_ms',render:value=>value===null?'暂无数据':`${Math.round(value)} ms`},{title:'累计成本',dataIndex:'cost_usd',render:value=>value===null?'暂无数据':`$${Number(value).toFixed(6)}`}]} /><Space/></Card>;
}
