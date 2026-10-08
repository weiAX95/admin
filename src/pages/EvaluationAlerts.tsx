import { useCallback, useEffect, useState } from 'react';
import { Alert, Button, Card, Table, Tag, Typography } from 'antd';
import { Link } from 'react-router-dom';
import { listEvaluationAlerts } from '../api/experiment-evaluation';
import type { EvaluationAlert } from '../api/experiment-evaluation';
import { downloadDegradedCsv } from '../utils/evaluationRegressionCsv';

export default function EvaluationAlerts() {
  const [items,setItems]=useState<EvaluationAlert[]>([]),[error,setError]=useState('');
  const load=useCallback(()=>listEvaluationAlerts().then(value=>{setItems(value.items);setError('');}).catch(cause=>setError(cause instanceof Error?cause.message:'告警加载失败')),[]);
  useEffect(()=>{void load();},[load]);
  return <Card title="评测退化告警" extra={<Button onClick={()=>void load()}>刷新</Button>}>
    <Typography.Paragraph type="secondary">仅比较用例键、输入和指标版本均可比的运行；每个指标按固定目标范围归一化，下降超过版本阈值时生成持久告警。</Typography.Paragraph>
    {error&&<Alert type="error" showIcon message={error}/>}
    <Table rowKey="id" dataSource={items} expandable={{expandedRowRender:item=><Table size="small" rowKey={row=>`${row.caseKey}-${row.metric}`} pagination={{pageSize:20}} dataSource={item.details} columns={[{title:'用例',dataIndex:'caseKey'},{title:'指标',dataIndex:'metric'},{title:'下降',dataIndex:'drop',render:value=><Tag color="red">{value}</Tag>},{title:'影响通过率',dataIndex:'affectedPassRate',render:value=>value?'是':'否'}]}/>}} columns={[{title:'时间',dataIndex:'created_at',render:value=>new Date(value).toLocaleString()},{title:'受影响用例',dataIndex:'affected_count'},{title:'指标下降项',render:(_,row)=>row.details.length},{title:'报告',render:(_,row)=><Link to={`/experiments/reports/${row.batch_id}`}>查看报告</Link>},{title:'导出',render:(_,row)=><Button type="link" onClick={()=>downloadDegradedCsv(row.details,`退化用例-${row.batch_id.slice(0,8)}.csv`)}>CSV</Button>}]} />
  </Card>;
}
