import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, App, Button, Card, Empty, Popconfirm, Select, Space, Spin, Typography } from 'antd';
import { createContentComment, deleteContentComment, listContentComments, updateContentComment, type ContentComment, type ContentKind } from '../api/contentComments';
import { getStoredUser } from '../api/client';
import type { AuthUser } from '../types';
import { isAdministrator } from '../utils/roles';
import MarkdownContent from './MarkdownContent';
import MarkdownEditor from './MarkdownEditor';

export default function ContentComments({ kind, entityId }: { kind:ContentKind; entityId:string }) {
  const { message } = App.useApp();
  const me = getStoredUser<AuthUser>();
  const [items,setItems] = useState<ContentComment[]>([]);
  const [total,setTotal] = useState(0);
  const [order,setOrder] = useState<'newest'|'oldest'>('newest');
  const [loading,setLoading] = useState(false);
  const [busy,setBusy] = useState(false);
  const [error,setError] = useState('');
  const requestId = useRef(0);
  const [content,setContent] = useState('');
  const [replyTo,setReplyTo] = useState<ContentComment | null>(null);
  const [editing,setEditing] = useState<ContentComment | null>(null);
  const [editContent,setEditContent] = useState('');
  const load = useCallback(async (offset=0) => {
    const request = ++requestId.current;
    setLoading(true);
    try {
      const result = await listContentComments(kind,entityId,order,offset);
      if (request !== requestId.current) return;
      setItems(previous=>offset ? [...previous,...result.items] : result.items);
      setTotal(result.total); setError('');
    } catch (cause) { if (request === requestId.current) setError(cause instanceof Error?cause.message:'评论加载失败'); }
    finally { if (request === requestId.current) setLoading(false); }
  },[kind,entityId,order]);
  useEffect(()=>{ setItems([]); setTotal(0); setReplyTo(null); setEditing(null); void load(); return ()=>{requestId.current++;}; },[load]);
  const save = async () => {
    if (!content.trim()) return;
    setBusy(true);
    try { await createContentComment(kind,entityId,content,replyTo?.id); setContent(''); setReplyTo(null); await load(); message.success('评论已保存'); }
    catch (cause) { message.error(cause instanceof Error?cause.message:'保存评论失败'); }
    finally { setBusy(false); }
  };
  const change = async (item:ContentComment,remove=false) => {
    setBusy(true);
    try {
      if (remove) await deleteContentComment(kind,entityId,item.id,item.version);
      else await updateContentComment(kind,entityId,item.id,item.version,editContent);
      setEditing(null); setEditContent(''); await load(); message.success(remove?'评论已删除':'评论已修改');
    } catch (cause) { message.error(cause instanceof Error?cause.message:'评论操作失败'); await load(); }
    finally { setBusy(false); }
  };
  const renderComment = (item:ContentComment,reply=false) => <Card size="small" key={item.id} style={{marginTop:reply?8:12,marginLeft:reply?24:0}}>
    <Space direction="vertical" style={{width:'100%'}} size={8}>
      <Space wrap><Typography.Text strong>{item.authorName}</Typography.Text><Typography.Text type="secondary">{new Date(item.createdAt).toLocaleString('zh-CN')}</Typography.Text>{item.updatedAt!==item.createdAt && !item.deletedAt && <Typography.Text type="secondary">已编辑</Typography.Text>}</Space>
      {item.deletedAt ? <Typography.Text type="secondary">评论已删除</Typography.Text> : editing?.id===item.id ? <MarkdownEditor value={editContent} onChange={setEditContent} rows={5} ariaLabel="修改评论" /> : <MarkdownContent content={item.content || ''} />}
      {!item.deletedAt && <Space wrap>
        {!reply && <Button size="small" type="link" onClick={()=>{setReplyTo(item);setContent('');}}>回复</Button>}
        {(me?.id===item.authorId || isAdministrator(me)) && <>
          {editing?.id===item.id ? <><Button size="small" type="primary" loading={busy} disabled={!editContent.trim()} onClick={()=>void change(item)}>保存修改</Button><Button size="small" onClick={()=>setEditing(null)}>取消</Button></> : <Button size="small" type="link" onClick={()=>{setEditing(item);setEditContent(item.content || '');}}>编辑</Button>}
          <Popconfirm title="删除这条评论？" onConfirm={()=>void change(item,true)}><Button size="small" danger type="link" disabled={busy}>删除</Button></Popconfirm>
        </>}
      </Space>}
      {item.replies?.map(child=>renderComment(child,true))}
    </Space>
  </Card>;
  return <Card title={`讨论（${total} 条主题）`} extra={<Select aria-label="评论排序" value={order} onChange={setOrder} style={{width:130}} options={[{value:'newest',label:'最新优先'},{value:'oldest',label:'最早优先'}]} />}>
    {error && <Alert type="error" showIcon message={error} action={<Button size="small" onClick={()=>void load()}>重试</Button>} />}
    {items.map(item=>renderComment(item))}
    {loading && <Spin />}
    {!loading && !items.length && !error && <Empty description="暂无评论" image={Empty.PRESENTED_IMAGE_SIMPLE} />}
    {items.length<total && <Button block disabled={loading} onClick={()=>void load(items.length)} style={{marginTop:12}}>加载更多</Button>}
    <div style={{marginTop:20}}>{replyTo && <Space><Typography.Text>回复 {replyTo.authorName}</Typography.Text><Button size="small" onClick={()=>setReplyTo(null)}>取消回复</Button></Space>}
      <MarkdownEditor value={content} onChange={setContent} rows={5} ariaLabel={replyTo?'回复评论':'发表评论'} placeholder="写下评论，支持 Markdown" />
      <Button type="primary" loading={busy} disabled={!content.trim()} onClick={()=>void save()} style={{marginTop:8}}>发布{replyTo?'回复':'评论'}</Button>
    </div>
  </Card>;
}
