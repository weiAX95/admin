import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, Button, Empty, Select, Space, Spin, Timeline, Typography } from 'antd';
import { listSpaceActivity, type SpaceActivityItem } from '../api/spaces';

const actions = [
  ['space.created','创建空间'],['space.updated','修改空间'],['space.archived','归档空间'],
  ['space.restored','恢复空间'],['space.deleted','删除空间'],['member.added','添加成员'],
  ['member.role_changed','修改角色'],['member.removed','移除成员'],['owner.transferred','转让 Owner'],
] as const;
const actionLabel = (value:string) => actions.find(([key])=>key===value)?.[1] || value;

export default function SpaceActivity({ spaceId, refreshVersion = 0 }: {spaceId:string;refreshVersion?:number}) {
  const [items,setItems] = useState<SpaceActivityItem[]>([]);
  const [total,setTotal] = useState(0);
  const [actors,setActors] = useState<{actor_id:string;actor_name:string}[]>([]);
  const [action,setAction] = useState<string>();
  const [actorId,setActorId] = useState<string>();
  const [resourceType,setResourceType] = useState<'space'|'member'>();
  const [loading,setLoading] = useState(false);
  const [error,setError] = useState('');
  const request = useRef(0);
  const loadingRef = useRef(false);
  const refresh = useCallback(async (replace=false) => {
    if (loadingRef.current) return;
    const sequence=++request.current;
    loadingRef.current=true; setLoading(true);
    try {
      const result=await listSpaceActivity(spaceId,{action,actorId,resourceType,offset:0,limit:20});
      if (sequence!==request.current) return;
      setItems(current=>replace ? result.items : [...result.items,...current.filter(item=>!result.items.some(recent=>recent.id===item.id))].slice(0,Math.max(current.length,20)));
      setTotal(result.total);setActors(result.actors);setError('');
    } catch(cause) { if(sequence===request.current)setError(cause instanceof Error?cause.message:'活动加载失败'); }
    finally { if(sequence===request.current){loadingRef.current=false;setLoading(false);} }
  },[spaceId,action,actorId,resourceType]);
  const loadMore=async()=>{
    if(loadingRef.current)return;
    const sequence=++request.current;
    loadingRef.current=true;setLoading(true);
    try {
      const result=await listSpaceActivity(spaceId,{action,actorId,resourceType,offset:items.length,limit:20});
      if(sequence!==request.current)return;
      setItems(current=>[...current,...result.items.filter(item=>!current.some(existing=>existing.id===item.id))]);
      setTotal(result.total);setActors(result.actors);setError('');
    } catch(cause) { if(sequence===request.current)setError(cause instanceof Error?cause.message:'活动加载失败'); }
    finally { if(sequence===request.current){loadingRef.current=false;setLoading(false);} }
  };
  useEffect(()=>{
    request.current++;loadingRef.current=false;setItems([]);setTotal(0);
    void refresh(true);
    const timer=window.setInterval(()=>{if(!document.hidden)void refresh();},4000);
    return()=>{window.clearInterval(timer);request.current++;loadingRef.current=false;};
  },[refresh,refreshVersion]);
  return <Space direction="vertical" style={{width:'100%'}} size={12}>
    <Space wrap>
      <Select allowClear placeholder="全部操作" aria-label="按操作筛选空间活动" value={action} onChange={setAction} style={{width:145}} options={actions.map(([value,label])=>({value,label}))} />
      <Select allowClear showSearch optionFilterProp="label" placeholder="全部用户" aria-label="按用户筛选空间活动" value={actorId} onChange={setActorId} style={{width:150}} options={actors.map(item=>({value:item.actor_id,label:item.actor_name}))} />
      <Select allowClear placeholder="全部资源" aria-label="按资源类型筛选空间活动" value={resourceType} onChange={setResourceType} style={{width:140}} options={[{value:'space',label:'空间'},{value:'member',label:'成员'}]} />
      <Button size="small" onClick={()=>void refresh(true)}>刷新</Button>
    </Space>
    {error && <Alert type="error" showIcon message={error} action={<Button size="small" onClick={()=>void refresh(true)}>重试</Button>} />}
    {items.length ? <Timeline items={items.map(item=>({key:item.id,children:<div><Typography.Text strong>{item.actor_name}</Typography.Text> · {actionLabel(item.action)}{item.detail && <Typography.Text type="secondary"> · {item.detail}</Typography.Text>}<div><Typography.Text type="secondary">{new Date(item.occurred_at).toLocaleString('zh-CN')}</Typography.Text></div></div>}))} /> : !loading && !error ? <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无空间活动" /> : null}
    {loading && <Spin size="small" />}
    {items.length<total && <Button block disabled={loading} onClick={()=>void loadMore()}>加载更多</Button>}
  </Space>;
}
