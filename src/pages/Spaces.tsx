import { useCallback, useEffect, useState } from 'react';
import { Alert, App, Button, Card, Col, Drawer, Empty, Form, Input, Modal, Popconfirm, Row, Select, Space, Spin, Tag, Typography } from 'antd';
import { addSpaceMembers, changeSpaceMemberRole, createSpace, deleteSpace, findSpaceCandidates, listDeletedSpaces, listSpaceMembers, listSpaces, removeSpaceMember, restoreSpace, transferSpaceOwner, updateSpace, type Space as TeamSpace, type SpaceCandidate, type SpaceMember } from '../api/spaces';

const roleLabel = { owner:'Owner', editor:'Editor', viewer:'Viewer' };
const roleOptions = [{value:'editor',label:'Editor · 可编辑'}, {value:'viewer',label:'Viewer · 只读'}] as const;

export default function Spaces() {
  const { message, modal } = App.useApp();
  const [form] = Form.useForm<{name:string;description:string;icon:string}>();
  const [items,setItems] = useState<TeamSpace[]>([]);
  const [deleted,setDeleted] = useState<(TeamSpace & {deletedAt:string})[]>([]);
  const [recycleOpen,setRecycleOpen] = useState(false);
  const [selected,setSelected] = useState<TeamSpace | null>(null);
  const [members,setMembers] = useState<SpaceMember[]>([]);
  const [candidates,setCandidates] = useState<SpaceCandidate[]>([]);
  const [candidateQuery,setCandidateQuery] = useState('');
  const [chosen,setChosen] = useState<string[]>([]);
  const [newRole,setNewRole] = useState<'editor'|'viewer'>('viewer');
  const [editing,setEditing] = useState<TeamSpace | 'new' | null>(null);
  const [loading,setLoading] = useState(true);
  const [busy,setBusy] = useState(false);
  const [error,setError] = useState('');
  const load = useCallback(async () => {
    setLoading(true);
    try { const data=await listSpaces(); setItems(data.items); setError(''); setSelected(current => data.items.find(item=>item.id===current?.id) || null); }
    catch(cause) { setError(cause instanceof Error ? cause.message : '读取空间失败'); }
    finally { setLoading(false); }
  },[]);
  const openRecycle = async () => {
    setRecycleOpen(true);
    try { setDeleted((await listDeletedSpaces()).items); }
    catch(cause) { message.error(cause instanceof Error?cause.message:'读取空间回收站失败'); }
  };
  useEffect(()=>{ void load(); },[load]);
  useEffect(()=>{
    if (!selected) { setMembers([]); return; }
    let active=true;
    void listSpaceMembers(selected.id).then(data=>{if(active)setMembers(data.items);}).catch(cause=>{if(active)message.error(cause instanceof Error?cause.message:'读取成员失败');});
    return ()=>{active=false;};
  },[selected?.id,message]);
  useEffect(()=>{
    if (!selected || selected.role!=='owner' || selected.status==='archived') return;
    let active=true;
    const timer=window.setTimeout(()=>{void findSpaceCandidates(selected.id,candidateQuery).then(data=>{if(active)setCandidates(data.items);}).catch(()=>{if(active)setCandidates([]);});},300);
    return ()=>{active=false;window.clearTimeout(timer);};
  },[selected?.id,selected?.role,selected?.status,candidateQuery,members.length]);
  const act = async (task:()=>Promise<unknown>,success:string,refreshMembers=true) => {
    setBusy(true);
    try { await task(); message.success(success); await load(); if(selected && refreshMembers) { const data=await listSpaceMembers(selected.id); setMembers(data.items); } return true; }
    catch(cause) { message.error(cause instanceof Error?cause.message:'操作失败'); await load(); return false; }
    finally { setBusy(false); }
  };
  const openForm = (item:TeamSpace|'new') => { setEditing(item); form.setFieldsValue(item==='new'?{name:'',description:'',icon:'team'}:{name:item.name,description:item.description,icon:item.icon}); };
  const saveForm = async () => {
    try {
      const value=await form.validateFields();
      if (await act(()=>editing==='new'?createSpace(value):updateSpace((editing as TeamSpace).id,(editing as TeamSpace).version,value),'空间已保存')) setEditing(null);
    } catch { /* Validation errors are shown by the form. */ }
  };
  const changeStatus = (item:TeamSpace) => void act(()=>updateSpace(item.id,item.version,{status:item.status==='active'?'archived':'active'}),item.status==='active'?'空间已归档':'空间已恢复');
  const transfer = (member:SpaceMember) => modal.confirm({title:`将 Owner 转让给 ${member.name||member.username}？`,content:'转让后你将成为 Editor，只有新 Owner 能管理空间和成员。',onOk:()=>act(()=>transferSpaceOwner(selected!.id,selected!.version,member.id),'所有权已转让')});

  return <Space direction="vertical" size={16} style={{width:'100%'}}>
    <Alert type="info" showIcon message="空间成员管理已开放" description="任务、笔记、实验、提示词和评测数据集仍沿用原有权限。空间内容切换将在数据隔离接通后开放。" />
    <Space style={{justifyContent:'space-between',width:'100%'}}><Typography.Text type="secondary">仅显示你拥有或加入的空间</Typography.Text><Space><Button onClick={()=>void openRecycle()}>空间回收站</Button><Button type="primary" onClick={()=>openForm('new')}>创建空间</Button></Space></Space>
    {error && <Alert type="error" showIcon message={error} action={<Button size="small" onClick={()=>void load()}>重试</Button>} />}
    {loading && !items.length ? <Spin /> : items.length ? <Row gutter={[16,16]}>{items.map(item=><Col xs={24} md={12} xl={8} key={item.id}><Card title={item.name} extra={<Tag color={item.status==='archived'?'default':'blue'}>{item.status==='archived'?'已归档':roleLabel[item.role]}</Tag>}>
      <Typography.Paragraph ellipsis={{rows:2}}>{item.description||'暂无说明'}</Typography.Paragraph><Typography.Text type="secondary">{item.icon} · {new Date(item.createdAt).toLocaleDateString('zh-CN')}</Typography.Text><div><Button type="link" onClick={()=>setSelected(item)}>查看空间与成员</Button></div>
    </Card></Col>)}</Row> : <Empty description="暂无团队空间"><Button type="primary" onClick={()=>openForm('new')}>创建第一个空间</Button></Empty>}
    <Modal title={editing==='new'?'创建空间':'编辑空间'} open={Boolean(editing)} onCancel={()=>setEditing(null)} onOk={()=>void saveForm()} confirmLoading={busy} okText="保存">
      <Form form={form} layout="vertical"><Form.Item name="name" label="空间名称" rules={[{required:true,max:80}]}><Input maxLength={80} /></Form.Item><Form.Item name="description" label="说明"><Input.TextArea maxLength={2000} rows={3} /></Form.Item><Form.Item name="icon" label="图标标识" rules={[{required:true,pattern:/^[a-z0-9_-]{1,40}$/i,message:'使用字母、数字、连字符或下划线'}]}><Input maxLength={40} /></Form.Item></Form>
    </Modal>
    <Drawer title={selected?.name} open={Boolean(selected)} onClose={()=>{setSelected(null);setChosen([]);}} width="min(580px,100vw)" extra={selected?.role==='owner'&&<Button onClick={()=>openForm(selected)}>编辑</Button>}>
      {selected && <Space direction="vertical" size={16} style={{width:'100%'}}>
        <Space><Tag>{roleLabel[selected.role]}</Tag><Tag>{selected.status==='archived'?'只读归档':'进行中'}</Tag></Space>
        <Typography.Paragraph>{selected.description||'暂无说明'}</Typography.Paragraph>
        <Typography.Title level={5}>成员</Typography.Title>
        {members.length ? members.map(member=><Card size="small" key={member.id}><Space style={{width:'100%',justifyContent:'space-between'}} wrap><span>{member.name||member.username} <Typography.Text type="secondary">@{member.username}</Typography.Text></span>{selected.role==='owner'&&selected.status==='active'?<Space><Select aria-label={`${member.username} 的空间角色`} value={member.role} style={{width:110}} options={[...roleOptions]} disabled={busy} onChange={role=>void act(()=>changeSpaceMemberRole(selected.id,member.id,role),'角色已更新')} /><Button size="small" onClick={()=>transfer(member)}>转让 Owner</Button><Popconfirm title="移除该成员？" onConfirm={()=>void act(()=>removeSpaceMember(selected.id,member.id),'成员已移除')}><Button size="small" danger>移除</Button></Popconfirm></Space>:<Tag>{roleLabel[member.role]}</Tag>}</Space></Card>) : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无其他成员" />}
        {selected.role==='owner'&&selected.status==='active'&&<Card size="small" title="添加成员"><Space direction="vertical" style={{width:'100%'}}><Select mode="multiple" showSearch filterOption={false} aria-label="搜索并选择账号" placeholder="搜索账号" value={chosen} searchValue={candidateQuery} onSearch={setCandidateQuery} onChange={setChosen} style={{width:'100%'}} options={candidates.map(account=>({value:account.id,label:`${account.name||account.username} (@${account.username})`}))} /><Space><Select aria-label="新成员默认角色" value={newRole} options={[...roleOptions]} onChange={setNewRole} style={{width:145}} /><Button type="primary" disabled={!chosen.length||busy} onClick={()=>void act(async()=>{await addSpaceMembers(selected.id,chosen.map(userId=>({userId,role:newRole})));setChosen([]);},'成员已添加')}>添加 {chosen.length||''} 人</Button></Space></Space></Card>}
        {selected.role==='owner'&&<Space><Button onClick={()=>changeStatus(selected)} loading={busy}>{selected.status==='active'?'归档空间':'恢复空间'}</Button><Popconfirm title="删除该空间？" description="成员将无法访问；保留期按系统设置执行。" onConfirm={()=>void act(async()=>{await deleteSpace(selected.id,selected.version);setSelected(null);},'空间已删除',false)}><Button danger loading={busy}>删除空间</Button></Popconfirm></Space>}
      </Space>}
    </Drawer>
    <Modal title="空间回收站" open={recycleOpen} onCancel={()=>setRecycleOpen(false)} footer={<Button onClick={()=>setRecycleOpen(false)}>关闭</Button>}>
      {deleted.length ? deleted.map(item=><Card size="small" key={item.id} style={{marginBottom:8}}><Space style={{width:'100%',justifyContent:'space-between'}}><span>{item.name} · {new Date(item.deletedAt).toLocaleString('zh-CN')}</span><Button size="small" disabled={busy} onClick={()=>void act(async()=>{await restoreSpace(item.id,item.version);setDeleted(current=>current.filter(space=>space.id!==item.id));},'空间已恢复',false)}>恢复</Button></Space></Card>) : <Empty description="没有可恢复的空间" />}
    </Modal>
  </Space>;
}
