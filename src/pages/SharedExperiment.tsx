import { useEffect, useState } from 'react';
import { Alert, Card, Descriptions, Empty, Spin, Table, Tag, Typography } from 'antd';
import { useParams } from 'react-router-dom';
import { getSharedExperiment } from '../api/experiment-sharing';
import type { SharedExperiment as SharedExperimentData } from '../api/experiment-sharing';
import MarkdownContent from '../components/MarkdownContent';

export default function SharedExperiment() {
  const { token } = useParams();
  const [experiment, setExperiment] = useState<SharedExperimentData | null>(null);
  const [error, setError] = useState('');
  useEffect(()=>{let alive=true;void getSharedExperiment(token||'').then(value=>{if(alive)setExperiment(value.experiment);}).catch(cause=>{if(alive)setError(cause instanceof Error?cause.message:'分享不可用');});return()=>{alive=false;};},[token]);
  if(error)return <Alert type="warning" showIcon message={error} style={{maxWidth:800,margin:'64px auto'}}/>;
  if(!experiment)return <Spin style={{display:'block',margin:'64px auto'}}/>;
  const sharedMarkdown = (content: string) => content.replace(/\/api\/assets\/([0-9a-f-]{36})/g, (_match, assetId: string) => `/api/assets/${assetId}?share=${encodeURIComponent(token||'')}`);
  return <div style={{maxWidth:1100,margin:'32px auto',padding:16}}><Card title={experiment.title} extra={<Tag>只读分享</Tag>}>
    {experiment.recordKind==='manual'?<><Descriptions items={[{key:'model',label:'模型',children:experiment.model||'无'},{key:'params',label:'参数',children:experiment.params||'无'},{key:'score',label:'自评',children:experiment.score??'暂无数据'}]}/><h3>Prompt</h3><MarkdownContent content={sharedMarkdown(experiment.prompt||'')}/><h3>结果</h3><MarkdownContent content={sharedMarkdown(experiment.result||'')}/></>:<><h3>System Prompt</h3><MarkdownContent content={sharedMarkdown(experiment.systemPrompt||'')}/><h3>User Prompt</h3><MarkdownContent content={sharedMarkdown(experiment.userPrompt||'')}/><Typography.Paragraph>变量：{JSON.stringify(experiment.variables||{})}</Typography.Paragraph><Table size="small" rowKey="label" pagination={false} dataSource={experiment.variants||[]} columns={[{title:'变体',dataIndex:'label'},{title:'模型',dataIndex:'model'},{title:'参数',dataIndex:'parameters',render:value=>JSON.stringify(value)}]}/><h3>最新运行</h3>{experiment.latestBatch?.runs.length?<Table rowKey={(_,index)=>String(index)} dataSource={experiment.latestBatch.runs} columns={[{title:'模型',dataIndex:'apiModel'},{title:'输出',dataIndex:'output',render:value=><MarkdownContent content={sharedMarkdown(value||'暂无输出')}/>},{title:'评分',dataIndex:'autoScore',render:value=>value??'暂无数据'},{title:'Token',render:(_,row)=>row.promptTokens===null?'暂无数据':`${row.promptTokens}/${row.completionTokens}`},{title:'延迟',dataIndex:'latencyMs',render:value=>value===null?'暂无数据':`${value} ms`},{title:'成本',dataIndex:'costUsd',render:value=>value===null?'暂无数据':`$${Number(value).toFixed(6)}`}]} />:<Empty description="暂无运行结果"/>}</>}
  </Card></div>;
}
