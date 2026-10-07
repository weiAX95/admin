import { useCallback, useEffect, useState } from 'react';
import { App, Alert, Button, Card, Col, Form, Input, Popconfirm, Row, Select, Space, Tag, Typography } from 'antd';
import { diffLines } from 'diff';
import { Link, useParams } from 'react-router-dom';
import { getStoredUser } from '../api/client';
import type { AuthUser } from '../types';
import { getPrompt, getPromptAnalytics, getPromptReferences, listPromptVersions, restorePromptVersion, savePromptVersion, updatePromptMeta } from '../api/prompts';
import type { PromptAnalytics, PromptPayload, PromptReferences, PromptVariable, PromptVersion } from '../api/prompts';
import PromptTextEditor from '../components/PromptTextEditor';
import PromptPreview from '../components/PromptPreview';
import PromptBlocksEditor from '../components/PromptBlocksEditor';

export default function PromptDetail() {
  const { id = '' } = useParams();
  const { message, modal } = App.useApp();
  const user = getStoredUser<AuthUser>();
  const [form] = Form.useForm<PromptPayload>();
  const [prompt,setPrompt] = useState<Awaited<ReturnType<typeof getPrompt>> | null>(null);
  const [versions,setVersions] = useState<PromptVersion[]>([]);
  const [selected,setSelected] = useState<PromptVersion | null>(null);
  const [compare,setCompare] = useState<string | null>(null);
  const [saving,setSaving] = useState(false);
  const [references,setReferences] = useState<PromptReferences | null>(null);
  const [analytics,setAnalytics] = useState<PromptAnalytics | null>(null);
  const content = Form.useWatch('content',form) || '';
  const variables = Form.useWatch('variables',form) || [];
  const canEdit = user?.role === 'admin' || user?.id === prompt?.owner_id;
  const refresh = useCallback(async () => {
    const [item,history,refs,stats] = await Promise.all([getPrompt(id),listPromptVersions(id),getPromptReferences(id),getPromptAnalytics(id)]);
    setReferences(refs);setAnalytics(stats);
    setPrompt(item); setVersions(history.items); setSelected(history.items[0]);
    const current = history.items[0];
    form.setFieldsValue({ content:current.content,type:current.prompt_type,format:current.format,variables:current.variables.map(variable=>({ ...variable, defaultValue:variable.defaultValue === undefined ? '' : String(variable.defaultValue), options:Array.isArray(variable.options) ? variable.options.join(', ') : variable.options })),messages:current.messages,blocks:current.blocks,expectedVersionId:current.id,bump:'patch',tags:item.tags,name:item.name });
    form.setFieldValue('toolSchema',current.tool_schema);
  },[id,form]);
  useEffect(() => { void refresh().catch(error => message.error(error instanceof Error ? error.message : '读取提示词失败')); },[refresh,message]);
  const save = async (values:PromptPayload,confirmFindings=false) => {
    setSaving(true);
    try {
      const result = await savePromptVersion(id,{...values,variables:values.variables || [],confirmFindings,expectedVersionId:versions[0]?.id});
      if (values.name !== prompt?.name || JSON.stringify(values.tags || []) !== JSON.stringify(prompt?.tags || [])) await updatePromptMeta(id,{name:values.name,tags:values.tags || []});
      message.success(`已保存 ${result.semver}`); if (result.warnings.length) message.warning(result.warnings.join('；')); await refresh();
    } catch(error) {
      if ((error as {status?:number}).status === 409 && !confirmFindings) modal.confirm({title:'疑似敏感信息',content:error instanceof Error ? error.message : '确认保存？',onOk:()=>void save(values,true)});
      else message.error(error instanceof Error ? error.message : '保存失败');
    } finally { setSaving(false); }
  };
  const restore = async (version:PromptVersion) => {
    try { const result=await restorePromptVersion(id,version.id,versions[0].id); message.success(`已恢复为新版本 ${result.semver}`); await refresh(); }
    catch(error) { message.error(error instanceof Error ? error.message : '恢复失败'); }
  };
  const active = selected || versions[0];
  const other = versions.find(version => version.id === compare);
  const selectedStats=analytics?.versions.find(item=>item.id===active?.id);
  const otherStats=analytics?.versions.find(item=>item.id===other?.id);
  const scoreCard=(title:string,stats:typeof selectedStats)=><Card size="small" title={title}><Space direction="vertical"><span>自动评分：{stats?.average_auto_score == null ? '暂无数据' : stats.average_auto_score.toFixed(1)}</span><span>人工评分：{stats?.average_human_rating == null ? '暂无数据' : stats.average_human_rating.toFixed(1)}（{stats?.human_count || 0} 次）</span><span>调用：{stats?.calls || 0}，成功：{stats?.completed || 0}</span><span>平均输入 token：{stats?.average_prompt_tokens == null ? '暂无数据' : stats.average_prompt_tokens.toFixed(0)}</span></Space></Card>;
  return <div><Space style={{marginBottom:16}}><Link to="/prompts">返回提示词库</Link><Typography.Title level={3} style={{margin:0}}>{prompt?.name || '加载中'}</Typography.Title><Tag>{versions[0]?.semver}</Tag></Space>
    <Row gutter={16}><Col xs={24} lg={15}><Card title="编辑与预览" extra={canEdit && <Button type="primary" loading={saving} onClick={() => form.submit()}>保存新版本</Button>}>
      {!canEdit && <Alert type="info" message="只有作者和管理员可编辑此提示词" style={{marginBottom:12}} />}
      <Form form={form} layout="vertical" onFinish={values=>void save(values)} disabled={!canEdit}>
        <Form.Item name="name" label="名称" rules={[{required:true}]}><Input /></Form.Item>
        <Form.Item name="tags" label="标签"><Select mode="tags" tokenSeparators={[',']} /></Form.Item>
        <Space wrap align="start"><Form.Item name="type" label="类型"><Select style={{width:180}} options={['system','user','assistant','tool_description'].map(value=>({value,label:value}))} /></Form.Item><Form.Item name="format" label="结构"><Select style={{width:150}} options={['text','chat','tool'].map(value=>({value,label:value}))} /></Form.Item><Form.Item name="bump" label="版本增量"><Select style={{width:140}} options={['patch','minor','major'].map(value=>({value,label:value}))} /></Form.Item></Space>
        <Form.Item name="content" label="正文"><PromptTextEditor rows={14} /></Form.Item>
        <PromptPreview content={content} variables={variables} />
        <PromptBlocksEditor form={form} />
        <Form.List name="variables">{(fields,{add,remove})=><div><Space><Typography.Title level={5}>变量定义</Typography.Title><Button onClick={()=>add({name:'',type:'string',required:true})}>添加</Button><Button onClick={()=>{const existing=form.getFieldValue('variables') || []; const names=[...new Set([...content.matchAll(/\{\{([A-Za-z_][A-Za-z0-9_]*)\}\}/g)].map(match=>match[1]))]; const missing=names.filter(name=>!existing.some((item:PromptVariable)=>item.name===name));form.setFieldValue('variables',[...existing,...missing.map(name=>({name,type:'string',required:true}))]);message.info(missing.length?`检测到 ${missing.length} 个新变量`:'没有新变量');}}>变量检测</Button></Space>{fields.map(field=><Row gutter={8} key={field.key} align="middle"><Col span={4}><Form.Item name={[field.name,'name']} rules={[{required:true}]}><Input placeholder="变量名" /></Form.Item></Col><Col span={3}><Form.Item name={[field.name,'type']}><Select options={['string','number','boolean','select'].map(value=>({value,label:value}))} /></Form.Item></Col><Col span={6}><Form.Item name={[field.name,'defaultValue']}><Input placeholder="默认值" /></Form.Item></Col><Col span={5}><Form.Item name={[field.name,'options']}><Input placeholder="选项，逗号分隔" /></Form.Item></Col><Col span={3}><Form.Item name={[field.name,'required']}><Select options={[{value:true,label:'必填'},{value:false,label:'可选'}]} /></Form.Item></Col><Col span={3}><Button onClick={()=>remove(field.name)}>删除</Button></Col></Row>)}</div>}</Form.List>
        {variables.some((item:PromptVariable)=>item.required && item.defaultValue === undefined) && <Alert type="warning" message="有必填变量没有默认值：可以保存，执行前须填写" />}
      </Form></Card></Col><Col xs={24} lg={9}><Card title="历史版本"><Space direction="vertical" style={{width:'100%'}}>{versions.map(version=><div key={version.id} style={{padding:10,border:'1px solid #30364c',borderRadius:8}}><Space><Button type="link" onClick={()=>setSelected(version)}>v{version.semver}</Button><Typography.Text type="secondary">{new Date(version.created_at).toLocaleString('zh-CN')} · {version.author_name || '历史作者未知'}</Typography.Text></Space><div>{version.change_summary.slice(0,100)}</div><Space><Button size="small" onClick={()=>setCompare(version.id)}>对比</Button>{canEdit && version.id !== versions[0]?.id && <Popconfirm title="将此历史内容保存为新版本？" onConfirm={()=>void restore(version)}><Button size="small">恢复此版本</Button></Popconfirm>}</Space></div>)}</Space></Card>
      {active && <Card title={`版本 ${active.semver} 内容`} style={{marginTop:16}}><pre style={{whiteSpace:'pre-wrap'}}>{active.content}</pre></Card>}
    </Col></Row>
    {active && other && <Card title={`逐行差异：${other.semver} → ${active.semver}`} style={{marginTop:16}}><div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:12}}><pre style={{whiteSpace:'pre-wrap'}}>{diffLines(other.content,active.content).filter(part=>!part.added).map((part,index)=><span key={index} style={{background:part.removed?'#673843':undefined}}>{part.value}</span>)}</pre><pre style={{whiteSpace:'pre-wrap'}}>{diffLines(other.content,active.content).filter(part=>!part.removed).map((part,index)=><span key={index} style={{background:part.added?'#29483b':undefined}}>{part.value}</span>)}</pre></div></Card>}
    {active && other && <Row gutter={16} style={{marginTop:16}}><Col span={12}>{scoreCard(`版本 ${other.semver}`,otherStats)}</Col><Col span={12}>{scoreCard(`版本 ${active.semver}`,selectedStats)}</Col></Row>}
    <Row gutter={16} style={{marginTop:16}}><Col xs={24} lg={12}><Card title="引用关系"><Typography.Title level={5}>引用了 {references?.outgoing.length || 0} 个提示词</Typography.Title>{references?.outgoing.map(item=><div key={item.version_id}><Link to={`/prompts/${item.id}`}>{item.name} · {item.semver}</Link></div>)}<Typography.Title level={5}>被 {references?.incoming.length || 0} 个提示词引用</Typography.Title>{references?.incoming.map(item=><div key={item.version_id}><Link to={`/prompts/${item.id}`}>{item.name} · {item.semver}</Link></div>)}<Typography.Title level={5}>被 {references?.experiments.length || 0} 个实验引用</Typography.Title>{references?.experiments.map(item=><div key={item.id}><Link to={`/experiments/${item.id}`}>{item.title}</Link></div>)}</Card></Col><Col xs={24} lg={12}><Card title="调用与评分（近 30 天）"><Typography.Paragraph>全部版本调用 {analytics?.versions.reduce((sum,item)=>sum+item.calls,0) || 0} 次 · 模型：{analytics?.models.join('、') || '暂无数据'}</Typography.Paragraph>{analytics?.trend.length ? <svg viewBox="0 0 320 100" role="img" aria-label="近 30 天调用趋势" style={{width:'100%',height:120}}><polyline fill="none" stroke="#9582ff" strokeWidth="3" points={analytics.trend.map((point,index)=>`${12+index*296/Math.max(1,analytics.trend.length-1)},${88-point.calls*72/Math.max(1,...analytics.trend.map(item=>item.calls))}`).join(' ')} /></svg> : <Typography.Text type="secondary">暂无调用数据</Typography.Text>}</Card></Col></Row>
  </div>;
}
