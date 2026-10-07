import { useCallback, useEffect, useState } from 'react';
import { App, Button, Card, Form, Input, InputNumber, Modal, Popconfirm, Select, Space, Table, Tag, Typography } from 'antd';
import { Link, useSearchParams } from 'react-router-dom';
import { createExperimentSchedule, deleteExperimentSchedule, getAccountTimeZone, listExperimentSchedules, saveAccountTimeZone, setExperimentScheduleActive } from '../api/experiment-schedules';
import type { ExperimentSchedule } from '../api/experiment-schedules';
import { listExperiments } from '../api/experiments';
import type { Experiment } from '../types';

type ScheduleValues = { experimentId: string; frequency: 'daily'|'weekly'|'monthly'; localTime: string; weekday?: number; dayOfMonth?: number; variablesText: string; retryLimit: number };
export default function ExperimentSchedules() {
  const { message } = App.useApp();
  const [search] = useSearchParams();
  const [items, setItems] = useState<ExperimentSchedule[]>([]);
  const [experiments, setExperiments] = useState<Experiment[]>([]);
  const [timeZone, setTimeZone] = useState('Asia/Shanghai');
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [form] = Form.useForm<ScheduleValues>();
  const frequency = Form.useWatch('frequency',form);
  const load = useCallback(() => listExperimentSchedules().then(value => setItems(value.items)).catch(error => message.error(error instanceof Error ? error.message : '加载失败')), [message]);
  useEffect(() => { void load(); void listExperiments().then(value => setExperiments(value.items.filter(item => item.recordKind === 'definition'))); void getAccountTimeZone().then(value => setTimeZone(value.timeZone)); }, [load]);
  const create = async (values: ScheduleValues) => { setBusy(true); try { const variables = JSON.parse(values.variablesText); if (!variables || typeof variables !== 'object' || Array.isArray(variables)) throw new Error('变量必须是 JSON 对象'); const result = await createExperimentSchedule({ experimentId: values.experimentId, frequency: values.frequency, localTime: values.localTime, weekday: values.weekday, dayOfMonth: values.dayOfMonth, variables, retryLimit: values.retryLimit }); message.success(`已创建，下一次 ${new Date(result.nextRunAt).toLocaleString('zh-CN')}`); setOpen(false); await load(); } catch (error) { message.error(error instanceof Error ? error.message : '创建失败'); } finally { setBusy(false); } };
  return <Card title="实验定时任务" extra={<Space><Link to="/experiments">返回实验</Link><Button type="primary" onClick={() => { form.setFieldsValue({ experimentId: search.get('experimentId') || undefined, frequency:'daily',localTime:'09:00',variablesText:'{}',retryLimit:1 }); setOpen(true); }}>新建调度</Button></Space>}>
    <Typography.Paragraph type="secondary">账号时区决定每天／每周／每月的本地执行时间；夏令时不存在的时刻顺延到首个有效分钟，重复时刻取第一次。月份缺少指定日期时取月末。可选邮件复用个人复习邮件设置。</Typography.Paragraph>
    <Space style={{marginBottom:20}}><Typography.Text>账号 IANA 时区</Typography.Text><Input style={{width:220}} value={timeZone} onChange={event=>setTimeZone(event.target.value)} placeholder="Asia/Shanghai"/><Button onClick={async()=>{try{await saveAccountTimeZone(timeZone);message.success('时区已保存');}catch(error){message.error(error instanceof Error?error.message:'保存失败');}}}>保存时区</Button></Space>
    <Table rowKey="id" dataSource={items} scroll={{x:900}} columns={[{title:'实验',dataIndex:'title',render:(value,row)=><Link to={`/experiments/${row.experimentId}`}>{value}</Link>},{title:'频率',dataIndex:'frequency'},{title:'本地时间',render:(_,row)=>`${row.timeZone} ${row.localTime}`},{title:'下次执行',dataIndex:'nextRunAt',render:value=>new Date(value).toLocaleString('zh-CN')},{title:'连续失败',dataIndex:'failureStreak'},{title:'状态',dataIndex:'active',render:value=><Tag color={value?'success':'warning'}>{value?'运行中':'已暂停'}</Tag>},{title:'操作',render:(_,row)=><Space><Button size="small" onClick={async()=>{try{await setExperimentScheduleActive(row.id,!row.active);await load();}catch(error){message.error(error instanceof Error?error.message:'操作失败');}}}>{row.active?'暂停':'恢复'}</Button><Popconfirm title="删除此调度？已生成运行将保留。" onConfirm={async()=>{await deleteExperimentSchedule(row.id);await load();}}><Button size="small" danger>删除</Button></Popconfirm></Space>}]} />
    <Modal title="新建实验调度" open={open} onCancel={()=>setOpen(false)} footer={null} width={650}><Form form={form} layout="vertical" onFinish={create}><Form.Item name="experimentId" label="实验" rules={[{required:true}]}><Select options={experiments.map(item=>({value:item.id,label:item.title}))}/></Form.Item><Space wrap><Form.Item name="frequency" label="频率" rules={[{required:true}]}><Select style={{width:130}} options={[{value:'daily',label:'每天'},{value:'weekly',label:'每周'},{value:'monthly',label:'每月'}]}/></Form.Item><Form.Item name="localTime" label="本地时间 HH:mm" rules={[{required:true}]}><Input style={{width:120}} placeholder="09:00"/></Form.Item>{frequency==='weekly'&&<Form.Item name="weekday" label="星期" rules={[{required:true}]}><Select style={{width:130}} options={['周日','周一','周二','周三','周四','周五','周六'].map((label,value)=>({label,value}))}/></Form.Item>}{frequency==='monthly'&&<Form.Item name="dayOfMonth" label="每月几号" rules={[{required:true}]}><InputNumber min={1} max={31}/></Form.Item>}<Form.Item name="retryLimit" label="单次失败重试" rules={[{required:true}]}><InputNumber min={0} max={5}/></Form.Item></Space><Form.Item name="variablesText" label="固定变量 JSON" rules={[{required:true}]}><Input.TextArea rows={4}/></Form.Item><Button type="primary" htmlType="submit" loading={busy}>创建调度</Button></Form></Modal>
  </Card>;
}
