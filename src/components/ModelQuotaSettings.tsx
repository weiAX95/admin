import { useEffect, useState } from 'react';
import { App, Button, Card, Form, InputNumber, Popconfirm, Select, Table, Typography } from 'antd';
import { listAccounts } from '../api/accounts';
import { getPlatformConfig } from '../api/experiment-platform';
import { deleteModelQuota, listModelQuotas, saveModelQuota, type ModelQuota } from '../api/model-quotas';

type QuotaForm=Pick<ModelQuota,'modelId'|'scope'|'subjectId'|'dailyTokens'>;
export default function ModelQuotaSettings(){
  const {message}=App.useApp();
  const [form]=Form.useForm<QuotaForm>();
  const scope=Form.useWatch('scope',form);
  const [items,setItems]=useState<ModelQuota[]>([]);
  const [models,setModels]=useState<{id:string;displayName:string}[]>([]);
  const [accounts,setAccounts]=useState<{id:string;username:string}[]>([]);
  const [busy,setBusy]=useState(false);
  const refresh=async()=>{const [quotas,config,users]=await Promise.all([listModelQuotas(),getPlatformConfig(),listAccounts()]);setItems(quotas.items);setModels(config.models);setAccounts(users.items);};
  useEffect(()=>{void refresh().catch(error=>message.error(error instanceof Error?error.message:'配额加载失败'));},[]);
  const save=async(values:QuotaForm)=>{setBusy(true);try{await saveModelQuota({...values,subjectId:values.scope==='model'?'*':values.subjectId});await refresh();message.success('日配额已保存');}catch(error){message.error(error instanceof Error?error.message:'保存失败');}finally{setBusy(false);}};
  const remove=async(item:ModelQuota)=>{setBusy(true);try{await deleteModelQuota(item);await refresh();message.success('配额规则已删除');}catch(error){message.error(error instanceof Error?error.message:'删除失败');}finally{setBusy(false);}};
  return <Card size="small" title="模型日 token 配额" style={{marginTop:16}}>
    <Typography.Paragraph type="secondary">按 UTC 自然日计算。用户规则优先于角色规则，角色规则优先于模型默认规则；当前按批次请求上限预留 token，重试沿用原预留。到达 80%／90%／100% 时生成站内通知。</Typography.Paragraph>
    <Form form={form} layout="inline" initialValues={{scope:'model',subjectId:'*'}} onFinish={save} style={{rowGap:8,marginBottom:16}}>
      <Form.Item name="modelId" label="模型" rules={[{required:true}]}><Select style={{width:160}} options={models.map(item=>({value:item.id,label:item.displayName}))} /></Form.Item>
      <Form.Item name="scope" label="层级"><Select style={{width:110}} options={[{value:'model',label:'模型默认'},{value:'role',label:'角色'},{value:'user',label:'用户'}]} onChange={()=>form.setFieldValue('subjectId',undefined)} /></Form.Item>
      {scope==='role'&&<Form.Item name="subjectId" label="角色" rules={[{required:true}]}><Select style={{width:120}} options={[{value:'admin',label:'管理员'},{value:'member',label:'成员'}]} /></Form.Item>}
      {scope==='user'&&<Form.Item name="subjectId" label="账号" rules={[{required:true}]}><Select style={{width:150}} options={accounts.map(item=>({value:item.id,label:item.username}))} /></Form.Item>}
      <Form.Item name="dailyTokens" label="每日 token" rules={[{required:true}]}><InputNumber min={1} max={1_000_000_000} precision={0} /></Form.Item>
      <Button type="primary" htmlType="submit" loading={busy}>保存</Button>
    </Form>
    <Table size="small" rowKey={item=>`${item.modelId}:${item.scope}:${item.subjectId}`} dataSource={items} pagination={{pageSize:5}} columns={[{title:'模型',dataIndex:'modelName'},{title:'层级',dataIndex:'scope'},{title:'对象',dataIndex:'subjectId'},{title:'日上限',dataIndex:'dailyTokens'},{title:'操作',render:(_,item)=><Popconfirm title="删除该配额规则？" onConfirm={()=>void remove(item)}><Button size="small" danger disabled={busy}>删除</Button></Popconfirm>}]} />
  </Card>;
}
