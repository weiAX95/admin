import { useCallback, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { App, AutoComplete, Button, Card, Checkbox, Drawer, Empty, Form, Input, Popconfirm, Select, Space, Table, Tag, Tree, Typography } from 'antd';
import { FolderAddOutlined, PlusOutlined } from '@ant-design/icons';
import { Link, useNavigate } from 'react-router-dom';
import { getStoredUser } from '../api/client';
import type { AuthUser } from '../types';
import { createPrompt, createPromptComplianceRule, createPromptFolder, deletePrompt, deletePromptComplianceRule, deletePromptFolder, listPromptComplianceRules, listPromptFolders, listPrompts, renamePromptFolder, searchPrompts, suggestPrompts, updatePromptMeta } from '../api/prompts';
import type { PromptFolder, PromptItem, PromptPayload } from '../api/prompts';
import PromptTextEditor from '../components/PromptTextEditor';
import PromptPreview from '../components/PromptPreview';

function folderNodes(folders: PromptFolder[], onMove: (promptId:string,folderId:string)=>void, parent: string | null = null): { key: string; title: ReactNode; children: ReturnType<typeof folderNodes> }[] {
  return folders.filter(item => item.parent_id === parent).map(item => ({ key: item.id, title: <span onDragOver={event=>event.preventDefault()} onDrop={event=>{ event.preventDefault(); const promptId=event.dataTransfer.getData('text/plain'); if(promptId) onMove(promptId,item.id); }}>{item.name}</span>, children: folderNodes(folders,onMove,item.id) }));
}
function highlighted(value:string,query:string) {
  if (!query) return value;
  const at=value.toLocaleLowerCase().indexOf(query.toLocaleLowerCase());
  return at<0 ? value : <>{value.slice(0,at)}<mark>{value.slice(at,at+query.length)}</mark>{value.slice(at+query.length)}</>;
}

export default function Prompts() {
  const { message, modal } = App.useApp();
  const navigate = useNavigate();
  const user = getStoredUser<AuthUser>();
  const [items,setItems] = useState<PromptItem[]>([]);
  const [folders,setFolders] = useState<PromptFolder[]>([]);
  const [rules,setRules] = useState<{id:string;name:string;pattern:string;active:boolean}[]>([]);
  const [rulesOpen,setRulesOpen] = useState(false);
  const [ruleName,setRuleName] = useState('');
  const [rulePattern,setRulePattern] = useState('');
  const [selectedFolder,setSelectedFolder] = useState<string | null>(null);
  const [keyword,setKeyword] = useState('');
  const [history,setHistory] = useState(false);
  const [regex,setRegex] = useState(false);
  const [matches,setMatches] = useState<PromptItem[] | null>(null);
  const [suggestions,setSuggestions] = useState<{value:string}[]>([]);
  const [searching,setSearching] = useState(false);
  const [creating,setCreating] = useState(false);
  const [saving,setSaving] = useState(false);
  const [form] = Form.useForm<PromptPayload>();
  const content = Form.useWatch('content', form) || '';
  const previewVariables = Form.useWatch('variables',form) || [];
  const refresh = useCallback(async () => { const [prompts,directory] = await Promise.all([listPrompts(),listPromptFolders()]); setItems(prompts.items); setFolders(directory.items); }, []);
  useEffect(() => { void refresh().catch(error => message.error(error instanceof Error ? error.message : '加载提示词失败')); }, [refresh,message]);
  useEffect(()=>{
    if (!keyword.trim()) { setMatches(null);setSuggestions([]);setSearching(false);return; }
    let cancelled=false;
    const timer=window.setTimeout(()=>{
      setSearching(true);
      void Promise.all([searchPrompts(keyword,history,regex),suggestPrompts(keyword)]).then(([results,hints])=>{
        if (!cancelled) {setMatches(results.items);setSuggestions(hints.items);}
      }).catch(error=>{if (!cancelled) message.error(error instanceof Error?error.message:'搜索失败');}).finally(()=>{if (!cancelled) setSearching(false);});
    },300);
    return ()=>{cancelled=true;window.clearTimeout(timer);};
  },[keyword,history,regex,message]);
  const shown = (matches || items).filter(item => !selectedFolder || item.folder_id === selectedFolder);
  const movePrompt = useCallback((promptId:string,folderId:string) => { void updatePromptMeta(promptId,{folderId}).then(()=>refresh()).then(()=>message.success('位置已保存')).catch(error=>message.error(error instanceof Error?error.message:'移动失败')); },[refresh,message]);
  const tree = useMemo(() => folderNodes(folders,movePrompt), [folders,movePrompt]);
  const save = async (values: PromptPayload, confirmFindings = false) => {
    setSaving(true);
    try {
      const result = await createPrompt({ ...values, folderId: selectedFolder, tags: values.tags || [], variables: values.variables || [], confirmFindings });
      if (result.warnings.length) message.warning(result.warnings.join('；'));
      message.success('提示词已创建'); setCreating(false); form.resetFields(); await refresh(); navigate(`/prompts/${result.id}`);
    } catch (error) {
      if ((error as { status?: number }).status === 409 && !confirmFindings) modal.confirm({ title: '疑似敏感信息', content: error instanceof Error ? error.message : '请确认保存', onOk: () => void save(values,true) });
      else message.error(error instanceof Error ? error.message : '保存失败');
    } finally { setSaving(false); }
  };
  const addFolder = () => {
    let name = '';
    modal.confirm({ title: '创建文件夹', content: <Input placeholder="文件夹名称" onChange={event => { name = event.target.value; }} />, onOk: async () => { await createPromptFolder(name,selectedFolder); await refresh(); message.success('文件夹已创建'); } });
  };
  const manageFolder = () => {
    if (!selectedFolder) return;
    const current = folders.find(item => item.id === selectedFolder);
    let name = current?.name || '';
    modal.confirm({ title: '重命名文件夹', content: <Input defaultValue={name} onChange={event => { name = event.target.value; }} />, onOk: async () => { await renamePromptFolder(selectedFolder,name); await refresh(); message.success('已重命名'); } });
  };
  const manageRules = async () => { try { setRules((await listPromptComplianceRules()).items); setRulesOpen(true); } catch(error) { message.error(error instanceof Error?error.message:'读取规则失败'); } };
  return <div><Card title="提示词库" extra={<Space>{user?.role==='admin' && <Button onClick={()=>void manageRules()}>合规规则</Button>}<Button icon={<PlusOutlined />} type="primary" onClick={() => { form.setFieldsValue({ type:'system', format:'text', content:'', tags:[], variables:[] }); setCreating(true); }}>新建提示词</Button></Space>}>
    <div style={{ display:'grid', gridTemplateColumns:'220px minmax(0,1fr)', gap:20 }}>
      <div><Space wrap><Button size="small" onClick={() => setSelectedFolder(null)}>全部</Button>{user?.role === 'admin' && <Button size="small" icon={<FolderAddOutlined />} onClick={addFolder}>新建文件夹</Button>}</Space>
        {tree.length ? <Tree treeData={tree} selectedKeys={selectedFolder ? [selectedFolder] : []} onSelect={keys => setSelectedFolder(keys.length ? String(keys[0]) : null)} style={{ marginTop:16 }} /> : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无文件夹" />}
        {user?.role === 'admin' && selectedFolder && <Space wrap style={{ marginTop:12 }}><Button size="small" onClick={manageFolder}>重命名</Button><Popconfirm title="删除空文件夹？" onConfirm={async () => { try { await deletePromptFolder(selectedFolder); setSelectedFolder(null); await refresh(); } catch(error) { message.error(error instanceof Error ? error.message : '删除失败'); } }}><Button size="small" danger>删除</Button></Popconfirm></Space>}
      </div>
      <div><Space wrap style={{marginBottom:12}}><AutoComplete style={{width:290}} value={keyword} options={suggestions} onChange={setKeyword}><Input.Search allowClear placeholder="搜索名称、正文、标签" loading={searching} /></AutoComplete><Checkbox checked={history} onChange={event=>setHistory(event.target.checked)}>搜索历史版本</Checkbox>{user?.role==='admin' && <Checkbox checked={regex} onChange={event=>setRegex(event.target.checked)}>受限正则</Checkbox>}</Space>
      <Table rowKey={item=>history&&keyword?item.version_id:item.id} dataSource={shown} onRow={item=>({draggable:user?.role==='admin'||user?.id===item.owner_id,onDragStart:event=>event.dataTransfer.setData('text/plain',item.id)})} locale={{ emptyText: keyword ? '没有匹配的提示词' : selectedFolder ? '空文件夹' : '暂无提示词' }} columns={[{ title:'名称', render:(_,item:PromptItem) => <div><Link to={`/prompts/${item.id}`}>{highlighted(item.name,keyword)}</Link>{keyword && item.content && <Typography.Paragraph ellipsis={{rows:2}} type="secondary">{highlighted(item.content.slice(0,180),keyword)}</Typography.Paragraph>}</div> },{ title:'类型',dataIndex:'prompt_type',render:value=><Tag>{value}</Tag> },{ title:'版本',dataIndex:'semver' },{ title:'标签',dataIndex:'tags',render:(tags:string[]) => <Space wrap>{tags?.map(tag=><Tag key={tag}>{highlighted(tag,keyword)}</Tag>)}</Space> },{ title:'评分',render:(_,item:PromptItem)=>item.average_auto_score==null&&item.average_human_rating==null?'暂无评分数据':`自动 ${item.average_auto_score?.toFixed(1) ?? '—'} / 人工 ${item.average_human_rating?.toFixed(1) ?? '—'}` },{ title:'更新时间',dataIndex:'updated_at',render:value=>new Date(value).toLocaleString('zh-CN') },{ title:'操作',render:(_,item:PromptItem) => (user?.role === 'admin' || user?.id === item.owner_id) && <Popconfirm title="将提示词移出目录？历史版本和引用会保留" onConfirm={async () => { await deletePrompt(item.id); await refresh(); }}><Button type="link" danger>删除</Button></Popconfirm> }]} /></div>
    </div>
  </Card>
  <Drawer title="新建提示词" open={creating} onClose={() => setCreating(false)} width="min(900px,100vw)" extra={<Button type="primary" loading={saving} onClick={() => form.submit()}>保存</Button>}><Form form={form} layout="vertical" onFinish={values => void save(values)}>
    <Form.Item name="name" label="名称" rules={[{ required:true }]}><Input maxLength={200} /></Form.Item>
    <Space align="start" wrap><Form.Item name="type" label="类型"><Select style={{ width:190 }} options={['system','user','assistant','tool_description'].map(value=>({value,label:value}))} /></Form.Item><Form.Item name="format" label="格式"><Select style={{ width:150 }} options={['text','chat','tool'].map(value=>({value,label:value}))} /></Form.Item></Space>
    <Form.Item name="tags" label="标签"><Select mode="tags" tokenSeparators={[',']} placeholder="输入后回车" /></Form.Item>
    <Form.Item name="content" label="正文（{{variable}} 会高亮）" rules={[{ required:true }]}><PromptTextEditor rows={12} placeholder="提示词正文" /></Form.Item>
    <PromptPreview content={content} variables={previewVariables} />
    <Form.List name="variables">{(fields,{add,remove})=><div><Space><Typography.Title level={5}>变量</Typography.Title><Button onClick={() => add({name:'',type:'string',required:true})}>添加变量</Button><Button onClick={() => { const existing=form.getFieldValue('variables') || []; const names=[...new Set([...content.matchAll(/\{\{([A-Za-z_][A-Za-z0-9_]*)\}\}/g)].map(match=>match[1]))]; const missing=names.filter(name=>!existing.some((item:{name:string})=>item.name===name)); form.setFieldValue('variables',[...existing,...missing.map(name=>({name,type:'string',required:true}))]); message.info(missing.length ? `检测到 ${missing.length} 个新变量` : '没有新变量'); }}>变量检测</Button></Space>{fields.map(field=><Space key={field.key} align="start" wrap><Form.Item name={[field.name,'name']} rules={[{required:true}]}><Input placeholder="变量名" /></Form.Item><Form.Item name={[field.name,'type']}><Select style={{width:120}} options={['string','number','boolean','select'].map(value=>({value,label:value}))} /></Form.Item><Form.Item name={[field.name,'defaultValue']}><Input placeholder="默认值（number 填数字，boolean 填 true/false）" /></Form.Item><Form.Item name={[field.name,'options']}><Input placeholder="select 选项，逗号分隔" /></Form.Item><Form.Item name={[field.name,'required']}><Select style={{width:100}} options={[{value:true,label:'必填'},{value:false,label:'可选'}]} /></Form.Item><Button onClick={() => remove(field.name)}>删除</Button></Space>)}</div>}</Form.List>
  </Form></Drawer>
  <Drawer title="自定义敏感信息规则" open={rulesOpen} onClose={()=>setRulesOpen(false)} width="min(640px,100vw)"><Typography.Paragraph>只支持不含分组和分支的有限重复正则。命中后编辑者须确认保存。</Typography.Paragraph>{rules.map(rule=><div key={rule.id} style={{padding:8}}><Space><code>{rule.name}: {rule.pattern}</code><Popconfirm title="删除此规则？" onConfirm={async()=>{await deletePromptComplianceRule(rule.id);setRules((await listPromptComplianceRules()).items);}}><Button size="small" danger>删除</Button></Popconfirm></Space></div>)}<Space direction="vertical" style={{width:'100%',marginTop:16}}><Input placeholder="规则名称" value={ruleName} onChange={event=>setRuleName(event.target.value)} /><Input placeholder="安全正则，例如 ABC-[0-9]{4}" value={rulePattern} onChange={event=>setRulePattern(event.target.value)} /><Button onClick={async()=>{try{await createPromptComplianceRule(ruleName,rulePattern);setRuleName('');setRulePattern('');setRules((await listPromptComplianceRules()).items);message.success('规则已添加');}catch(error){message.error(error instanceof Error?error.message:'保存失败');}}}>添加规则</Button></Space></Drawer></div>;
}
