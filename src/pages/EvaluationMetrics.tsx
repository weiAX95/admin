import { isAdministrator } from '../utils/roles';
import { useCallback, useEffect, useState } from 'react';
import { Alert, App, Button, Card, Form, Input, InputNumber, Modal, Select, Space, Table, Tag, Typography } from 'antd';
import { createMetricVersion, createPythonMetricScript, getMetricCatalog, listMetricVersions, listPythonMetricScripts } from '../api/experiment-evaluation';
import type { MetricVersion } from '../api/experiment-evaluation';
import { listPromptVersions, listPrompts, searchPrompts } from '../api/prompts';
import type { PromptItem, PromptVersion } from '../api/prompts';
import { getStoredUser } from '../api/client';

const rules=[['exact','Exact Match'],['token_f1','Token F1'],['bleu','BLEU'],['rouge_l','ROUGE-L'],['tool_selection','工具选择准确率'],['parameter_accuracy','工具参数准确率'],['custom_python','隔离 Python'],['bertscore','BERTScore']];
function judgeCompatible(version: PromptVersion) {
  return version.prompt_type === 'system' && version.format === 'text'
    && !version.variables?.length && !version.messages?.length && !version.blocks?.length
    && !/\{\{[^{}]+\}\}|include:prompt:\/\/\S+/.test(version.content);
}
export default function EvaluationMetrics() {
  const { message }=App.useApp();
  const [items,setItems]=useState<MetricVersion[]>([]),[scripts,setScripts]=useState<{id:string;name:string}[]>([]);
  const [catalog,setCatalog]=useState<{pythonEnabled:boolean;bertScoreEnabled:boolean;tokenizerVersion:string}>();
  const [error,setError]=useState(''),[open,setOpen]=useState(false),[scriptOpen,setScriptOpen]=useState(false),[busy,setBusy]=useState(false);
  const [name,setName]=useState(''),[ruleType,setRuleType]=useState('exact'),[passThreshold,setPassThreshold]=useState(3),[normalizedRegressionThreshold,setNormalizedRegressionThreshold]=useState(0.2),[judgePrompt,setJudgePrompt]=useState('根据问题、参考答案与模型回答评分，并说明理由。'),[customScriptId,setCustomScriptId]=useState<string>();
  const [prompts,setPrompts]=useState<PromptItem[]>([]),[promptVersions,setPromptVersions]=useState<PromptVersion[]>([]);
  const [promptQuery,setPromptQuery]=useState(''),[selectedPromptId,setSelectedPromptId]=useState<string>(),[judgePromptVersionId,setJudgePromptVersionId]=useState<string>();
  const [scriptName,setScriptName]=useState(''),[source,setSource]=useState('def score(payload):\n    return 1.0 if payload["output"] == payload["expectedOutput"] else 0.0\n');
  const admin=isAdministrator(getStoredUser<{role:string}>());
  const load=useCallback(async()=>{try{const [versions,available,codes]=await Promise.all([listMetricVersions(),getMetricCatalog(),listPythonMetricScripts()]);setItems(versions.items);setCatalog(available);setScripts(codes.items);setError('');}catch(cause){setError(cause instanceof Error?cause.message:'指标加载失败');}},[]);
  useEffect(()=>{void load();},[load]);
  useEffect(()=>{
    if(!open) return;
    let cancelled=false;
    const timer=window.setTimeout(()=>{
      const query=promptQuery.trim();
      void (query?searchPrompts(query):listPrompts()).then(result=>{
        if(!cancelled)setPrompts(previous=>{
          const selected=previous.find(item=>item.id===selectedPromptId);
          return selected&&!result.items.some(item=>item.id===selected.id)?[selected,...result.items]:result.items;
        });
      }).catch(cause=>{if(!cancelled)message.error(cause instanceof Error?cause.message:'提示词库加载失败');});
    },promptQuery.trim()?300:0);
    return()=>{cancelled=true;window.clearTimeout(timer);};
  },[open,promptQuery,selectedPromptId,message]);
  useEffect(()=>{
    if(!open||!selectedPromptId){setPromptVersions([]);return;}
    let cancelled=false;
    void listPromptVersions(selectedPromptId).then(result=>{if(!cancelled)setPromptVersions(result.items);}).catch(cause=>{if(!cancelled)message.error(cause instanceof Error?cause.message:'提示词版本加载失败');});
    return()=>{cancelled=true;};
  },[open,selectedPromptId,message]);
  const saveScript=async()=>{setBusy(true);try{const created=await createPythonMetricScript(scriptName,source);setCustomScriptId(created.id);setScriptOpen(false);message.success('Python 指标已登记');await load();}catch(cause){message.error(cause instanceof Error?cause.message:'登记失败');}finally{setBusy(false);}};
  const saveMetric=async()=>{setBusy(true);try{await createMetricVersion({name,ruleType,passThreshold,regressionThreshold:0.2,normalizedRegressionThreshold,judgePrompt,...(judgePromptVersionId?{judgePromptVersionId}:{}),...(ruleType==='custom_python'?{customScriptId}:{})});setOpen(false);message.success('指标版本已创建');await load();}catch(cause){message.error(cause instanceof Error?cause.message:'保存失败');}finally{setBusy(false);}};
  const chooseJudgeVersion=(versionId:string)=>{
    const version=promptVersions.find(item=>item.id===versionId);
    if(!version||!judgeCompatible(version))return;
    setJudgePrompt(version.content);
    setJudgePromptVersionId(version.id);
  };
  return <Card title="评测指标版本" extra={admin?<Space><Button onClick={()=>setScriptOpen(true)} disabled={!catalog?.pythonEnabled}>登记 Python 指标</Button><Button type="primary" onClick={()=>{setPromptQuery('');setSelectedPromptId(undefined);setJudgePromptVersionId(undefined);setOpen(true);}}>新增指标版本</Button></Space>:null}>
    {error&&<Alert type="error" showIcon message={error}/>}
    <Typography.Paragraph type="secondary">文本和工具指标按固定分词版本 {catalog?.tokenizerVersion||'—'} 计算。效率指标在运行报告中展示 P50/P95/P99 延迟及平均输出 token。</Typography.Paragraph>
    <Space wrap style={{marginBottom:16}}><Tag color={catalog?.pythonEnabled?'green':'default'}>Python 沙箱：{catalog?.pythonEnabled?'就绪':'未安装镜像'}</Tag><Tag color={catalog?.bertScoreEnabled?'green':'default'}>BERTScore：{catalog?.bertScoreEnabled?'就绪':'默认关闭'}</Tag></Space>
    <Table rowKey="id" dataSource={items} columns={[{title:'指标',dataIndex:'name'},{title:'版本',dataIndex:'version',render:value=>`v${value}`},{title:'评分规则',dataIndex:'rule_type',render:value=>rules.find(([key])=>key===value)?.[1]||value},{title:'通过门槛',dataIndex:'pass_threshold'},{title:'退化阈值（归一化）',dataIndex:'normalized_regression_threshold'},{title:'Judge 提示词来源',render:(_,item:MetricVersion)=>item.judge_prompt_version_id?`${item.judge_prompt_name||'已删除条目'} · ${item.judge_prompt_semver||item.judge_prompt_version_id}`:'手写快照'}]} />
    <Modal title="登记隔离 Python 指标" open={scriptOpen} onCancel={()=>setScriptOpen(false)} onOk={()=>void saveScript()} okButtonProps={{loading:busy,disabled:!scriptName.trim()||!source.trim()}}><Typography.Paragraph type="secondary">源码须定义 score(payload)，返回 0–1 或 None。容器禁网、只读、非 root，单用例最多 30 秒。</Typography.Paragraph><Form.Item label="名称"><Input value={scriptName} onChange={event=>setScriptName(event.target.value)}/></Form.Item><Form.Item label="Python 源码"><Input.TextArea rows={10} value={source} onChange={event=>setSource(event.target.value)}/></Form.Item></Modal>
    <Modal title="新增指标版本" open={open} onCancel={()=>setOpen(false)} onOk={()=>void saveMetric()} okButtonProps={{loading:busy,disabled:!name.trim()||!judgePrompt.trim()||(ruleType==='custom_python'&&!customScriptId)}}>
      <Form.Item label="名称"><Input value={name} onChange={event=>setName(event.target.value)}/></Form.Item>
      <Form.Item label="规则"><Select value={ruleType} onChange={setRuleType} options={rules.map(([value,label])=>({value,label,disabled:value==='custom_python'&&!catalog?.pythonEnabled||value==='bertscore'&&!catalog?.bertScoreEnabled}))}/></Form.Item>
      {ruleType==='custom_python'&&<Form.Item label="固定脚本"><Select value={customScriptId} onChange={setCustomScriptId} options={scripts.map(item=>({value:item.id,label:item.name}))}/></Form.Item>}
      <Space><Form.Item label="通过门槛（0–5）"><InputNumber min={0} max={5} step={0.1} value={passThreshold} onChange={value=>setPassThreshold(value||0)}/></Form.Item><Form.Item label="退化阈值（0–1）"><InputNumber min={0} max={1} step={0.05} value={normalizedRegressionThreshold} onChange={value=>setNormalizedRegressionThreshold(value||0)}/></Form.Item></Space>
      <Form.Item label="从提示词库选择（可选）">
        <Select showSearch allowClear filterOption={false} placeholder="搜索提示词条目" value={selectedPromptId} onSearch={setPromptQuery} onChange={id=>{setSelectedPromptId(id);setJudgePromptVersionId(undefined);}} options={prompts.map(item=>({value:item.id,label:item.name}))}/>
      </Form.Item>
      {selectedPromptId&&<Form.Item label="固定版本"><Select placeholder="选择版本" value={judgePromptVersionId} onChange={chooseJudgeVersion} options={promptVersions.map(item=>({value:item.id,label:`v${item.semver}${judgeCompatible(item)?'':'（含变量、引用或非纯文本，不可用于 Judge）'}`,disabled:!judgeCompatible(item)}))}/></Form.Item>}
      <Form.Item label="Judge 提示词"><Input.TextArea rows={4} value={judgePrompt} onChange={event=>{setJudgePrompt(event.target.value);setJudgePromptVersionId(undefined);}}/></Form.Item>
      <Typography.Text type="secondary">选择版本后保存其完整快照；手工修改正文会自动解除版本关联。仅支持无变量、无引用的纯文本 System 版本。</Typography.Text>
    </Modal>
  </Card>;
}
