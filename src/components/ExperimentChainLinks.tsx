import { useEffect, useState } from 'react';
import { App, Button, Card, Empty, Popconfirm, Space, Tag, Typography } from 'antd';
import { Link } from 'react-router-dom';
import { confirmChain, getChainSuggestions } from '../api/experiment-evaluation';
import type { ExperimentDefinition } from '../api/experiment-platform';

export default function ExperimentChainLinks({ definition, canManage, onUpdated }: { definition: ExperimentDefinition; canManage: boolean; onUpdated: () => void }) {
  const { message } = App.useApp();
  const [items, setItems] = useState<{ id: string; title: string; similarity: number; chain_id: string | null }[]>([]);
  useEffect(() => { void getChainSuggestions(definition.id).then(value => setItems(value.items)).catch(() => undefined); }, [definition.id]);
  return <Card title="实验版本链" extra={definition.chainId ? <Link to={`/experiments/chains/${definition.chainId}`}>查看时间轴</Link> : null}>
    <Typography.Paragraph type="secondary">相似标题仅作为建议；确认后才建立稳定版本链。</Typography.Paragraph>
    {items.length ? <Space direction="vertical" style={{ width: '100%' }}>{items.map(item => <Space key={item.id} wrap><Link to={`/experiments/${item.id}`}>{item.title}</Link><Tag>相似度 {(item.similarity*100).toFixed(0)}%</Tag>{canManage && <Popconfirm title="将这两项实验归入同一版本链？" onConfirm={async () => { try { await confirmChain(definition.id, item.id); message.success('版本链已建立'); onUpdated(); } catch (cause) { message.error(cause instanceof Error ? cause.message : '操作失败'); } }}><Button size="small">确认关联</Button></Popconfirm>}</Space>)}</Space> : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无相似实验" />}
  </Card>;
}
