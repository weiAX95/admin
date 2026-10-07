import { useEffect, useState } from 'react';
import { App, Button, Descriptions, Modal, Radio, Space, Table, Tag, Typography } from 'antd';
import { createShare, listShares, revokeShare, sharePreview } from '../api/experiment-sharing';
import type { SharedExperiment } from '../api/experiment-sharing';

export default function ExperimentShareButton({ id }: { id: string }) {
  const { message, modal } = App.useApp();
  const [open, setOpen] = useState(false);
  const [preview, setPreview] = useState<SharedExperiment | null>(null);
  const [shares, setShares] = useState<{ id: string; expires_at: string | null; revoked_at: string | null; created_at: string }[]>([]);
  const [expiry, setExpiry] = useState<'1h'|'24h'|'7d'|'permanent'>('24h');
  const [createdUrl, setCreatedUrl] = useState('');
  const refresh = () => listShares(id).then(value => setShares(value.items));
  useEffect(() => { if (!open) return; void Promise.all([sharePreview(id), refresh()]).then(([value]) => setPreview(value.experiment)).catch(error => message.error(error instanceof Error ? error.message : '加载分享信息失败')); }, [open, id]);
  const create = () => {
    modal.confirm({ title: '确认公开以下实验内容？', content: `公开标题、完整提示词、变量、模型参数和最新输出。期限：${expiry}。持链接者无需登录即可查看。`, onOk: async () => {
      try { const result = await createShare(id, expiry); const url = `${window.location.origin}${result.path}`; setCreatedUrl(url); await refresh(); message.success('只读链接已创建'); }
      catch (error) { message.error(error instanceof Error ? error.message : '创建分享失败'); }
    } });
  };
  return <><Button onClick={() => setOpen(true)}>分享</Button><Modal title="实验只读分享" open={open} width={760} footer={null} onCancel={() => setOpen(false)}>
    <Typography.Paragraph type="secondary">创建前请核对公开字段。链接总是读取实验的最新配置和最新完成结果。</Typography.Paragraph>
    {preview && <Descriptions bordered size="small" column={1} items={[{ key:'title',label:'标题',children:preview.title },{key:'prompt',label:'System / 原始 Prompt',children:<div style={{whiteSpace:'pre-wrap',maxHeight:120,overflow:'auto'}}>{preview.systemPrompt || preview.prompt || '无'}</div>},{key:'user',label:'User Prompt',children:<div style={{whiteSpace:'pre-wrap',maxHeight:120,overflow:'auto'}}>{preview.userPrompt || '无'}</div>},{key:'variants',label:'模型与参数',children:preview.variants?.map(item=>`${item.model} ${JSON.stringify(item.parameters)}`).join('；') || preview.model || '无'},{key:'output',label:'最新结果',children:<div style={{whiteSpace:'pre-wrap',maxHeight:120,overflow:'auto'}}>{preview.latestBatch?.runs.map(item=>item.output).join('\n---\n') || preview.result || '暂无输出'}</div>}]} />}
    <Space wrap style={{marginTop:16}}><Radio.Group value={expiry} onChange={event=>setExpiry(event.target.value)} options={[{label:'1 小时',value:'1h'},{label:'24 小时',value:'24h'},{label:'7 天',value:'7d'},{label:'永久',value:'permanent'}]}/><Button type="primary" onClick={create}>创建分享链接</Button></Space>
    {createdUrl && <Typography.Paragraph copyable={{text:createdUrl}} style={{marginTop:16,overflowWrap:'anywhere'}}>{createdUrl}</Typography.Paragraph>}
    <Table size="small" style={{marginTop:18}} rowKey="id" dataSource={shares} pagination={false} columns={[{title:'创建时间',dataIndex:'created_at',render:value=>new Date(value).toLocaleString('zh-CN')},{title:'到期',dataIndex:'expires_at',render:value=>value?new Date(value).toLocaleString('zh-CN'):'永久'},{title:'状态',render:(_,row)=><Tag color={row.revoked_at?'default':row.expires_at&&Date.parse(row.expires_at)<=Date.now()?'warning':'success'}>{row.revoked_at?'已撤销':row.expires_at&&Date.parse(row.expires_at)<=Date.now()?'已过期':'有效'}</Tag>},{title:'操作',render:(_,row)=><Button danger type="link" disabled={Boolean(row.revoked_at)} onClick={()=>modal.confirm({title:'撤销此分享？',onOk:async()=>{await revokeShare(row.id);await refresh();message.success('已撤销');}})}>撤销</Button>}]} />
  </Modal></>;
}
