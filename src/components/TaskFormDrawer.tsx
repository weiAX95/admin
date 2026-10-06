import { useEffect, useState } from "react";
import {
  App,
  Button,
  Col,
  DatePicker,
  Drawer,
  Form,
  Input,
  InputNumber,
  Row,
  Select,
  Space,
  Switch,
} from "antd";
import { DeleteOutlined, PlusOutlined } from "@ant-design/icons";
import dayjs from "dayjs";
import { createTask, dependencyOptions, getRecurringSeries, listTaskTemplates, updateTask } from "../api/tasks";
import { PHASE_OPTIONS, PRESET_TASK_TAGS, PRIORITY_OPTIONS, STATUS_OPTIONS } from "./TaskMeta";
import type { LearningTask, RecurringSeries, TaskPayload, TaskTemplate, RecurrenceEndType, RecurrenceFrequency } from "../types";

type FormValues = Omit<TaskPayload, "dueDate" | "plannedStartDate" | "recurrence"> & {
  dueDate?: dayjs.Dayjs | null;
  plannedStartDate?: dayjs.Dayjs | null;
  recurrenceEnabled?: boolean;
  recurrenceFrequency?: RecurrenceFrequency;
  recurrenceInterval?: number;
  recurrenceEndType?: RecurrenceEndType;
  recurrenceEndCount?: number;
  recurrenceEndDate?: dayjs.Dayjs | null;
  syncFuture?: boolean;
};

function shanghaiPickerDate(value: string) {
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return dayjs(`${value}T00:00:00`);
  return dayjs(new Date(value).toLocaleString("sv-SE", { timeZone: "Asia/Shanghai" }));
}

interface Props {
  open: boolean;
  initial: LearningTask | null;
  onClose: () => void;
  onSaved: () => void;
}

export default function TaskFormDrawer({ open, initial, onClose, onSaved }: Props) {
  const [form] = Form.useForm<FormValues>();
  const [saving, setSaving] = useState(false);
  const [templates, setTemplates] = useState<TaskTemplate[]>([]);
  const [templateId, setTemplateId] = useState<string | undefined>();
  const [templateChecklist, setTemplateChecklist] = useState<string[]>([]);
  const [dependencies, setDependencies] = useState<{ id: string; title: string; status: string }[]>([]);
  const [series, setSeries] = useState<RecurringSeries | null>(null);
  const [seriesLoading, setSeriesLoading] = useState(false);
  const [seriesError, setSeriesError] = useState(false);
  const recurrenceEnabled = Form.useWatch("recurrenceEnabled", form);
  const recurrenceEndType = Form.useWatch("recurrenceEndType", form);
  const { message } = App.useApp();

  useEffect(() => {
    if (!open) return;
    let alive = true;
    form.resetFields();
    setTemplateId(undefined);
    setTemplateChecklist([]);
    setSeries(null);
    setSeriesError(false);
    setSeriesLoading(false);
    void dependencyOptions(initial?.id).then(result => setDependencies(result.items)).catch(() => setDependencies([]));
    if (initial) {
      form.setFieldsValue({
        ...initial,
        progress: initial.manualProgress ?? initial.progress,
        dueDate: initial.dueDate ? shanghaiPickerDate(initial.dueDate) : null,
        plannedStartDate: initial.plannedStartDate ? dayjs(initial.plannedStartDate) : null,
        recurrenceEnabled: false,
        recurrenceFrequency: "daily", recurrenceInterval: 1, recurrenceEndType: "never", syncFuture: false,
      });
      if (initial.recurringSeriesId) {
        setSeriesLoading(true);
        void getRecurringSeries(initial.recurringSeriesId).then(value => {
          if (!alive) return;
          setSeries(value);
          form.setFieldsValue({ recurrenceEnabled: value.active, recurrenceFrequency: value.frequency, recurrenceInterval: value.interval, recurrenceEndType: value.endType, recurrenceEndCount: value.endCount ?? undefined, recurrenceEndDate: value.endDate ? dayjs(value.endDate) : null });
        }).catch(error => { if (alive) { setSeriesError(true); message.error(error instanceof Error ? error.message : "加载重复配置失败"); } }).finally(() => { if (alive) setSeriesLoading(false); });
      }
    } else {
      void listTaskTemplates().then(result => setTemplates(result.items)).catch(() => setTemplates([]));
      form.setFieldsValue({
        status: "todo",
        priority: "medium",
        phase: "基础",
        progress: 0,
        category: "",
        dueDate: null,
        plannedStartDate: null,
        dependencyIds: [],
        resources: [],
        tags: [],
        recurrenceEnabled: false, recurrenceFrequency: "daily", recurrenceInterval: 1,
        recurrenceEndType: "never", recurrenceEndCount: undefined, recurrenceEndDate: null, syncFuture: false,
      });
    }
    return () => { alive = false; };
  }, [open, initial, form, message]);

  const handleFinish = async (values: FormValues) => {
    const { dueDate, plannedStartDate, tags, recurrenceEnabled: repeating, recurrenceFrequency, recurrenceInterval, recurrenceEndType: endType, recurrenceEndCount, recurrenceEndDate, syncFuture, ...rest } = values;
    if (dueDate && plannedStartDate && dueDate.isBefore(plannedStartDate, "day")) {
      message.error("截止日期不能早于计划开始日期");
      return;
    }
    if (repeating && (!dueDate || !dueDate.isValid())) { message.error("重复任务必须设置到期时间"); return; }
    const dueValue = dueDate ? (repeating || series ? new Date(`${dueDate.format("YYYY-MM-DDTHH:mm:ss")}+08:00`).toISOString() : dueDate.format("YYYY-MM-DD")) : "";
    if (repeating && !series && Date.parse(dueValue) <= Date.now()) { message.error("首次到期时间必须在未来"); return; }
    const rule = repeating ? {
      enabled: true, frequency: recurrenceFrequency || "daily", interval: recurrenceInterval || 1,
      endType: endType || "never", endCount: endType === "count" ? recurrenceEndCount : null,
      endDate: endType === "date" ? recurrenceEndDate?.format("YYYY-MM-DD") : null,
      ...(series ? { version: series.version, updateSnapshot: !!syncFuture } : {}),
    } : { enabled: false };
    const ruleChanged = !!series && !!repeating && (series.frequency !== recurrenceFrequency || series.interval !== recurrenceInterval || series.endType !== endType || series.endCount !== (endType === "count" ? recurrenceEndCount : null) || series.endDate !== (endType === "date" ? recurrenceEndDate?.format("YYYY-MM-DD") : null));
    const payload: TaskPayload = {
      ...rest,
      ...(!initial ? { tags } : {}),
      dueDate: dueValue,
      plannedStartDate: plannedStartDate ? plannedStartDate.format("YYYY-MM-DD") : "",
      ...(!initial && templateChecklist.length ? { checklist: templateChecklist.map((text, order) => ({ id: crypto.randomUUID(), text, done: false, order })) } : {}),
      ...((repeating && (!series || ruleChanged || syncFuture)) || (series?.active && !repeating) ? { recurrence: rule } : {}),
    };
    setSaving(true);
    try {
      if (initial) {
        await updateTask(initial.id, payload);
        message.success("已更新学习任务");
      } else {
        await createTask(payload);
        message.success("已创建学习任务");
      }
      onSaved();
    } catch (err) {
      message.error(err instanceof Error ? err.message : "保存失败");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Drawer
      title={initial ? "编辑学习任务" : "新建学习任务"}
      width={520}
      open={open}
      onClose={onClose}
      extra={
        <Button type="primary" loading={saving || seriesLoading} disabled={seriesLoading || seriesError} onClick={() => form.submit()}>
          保存
        </Button>
      }
    >
      <Form form={form} layout="vertical" onFinish={handleFinish}>
        {!initial && <Form.Item label="从模板创建">
          <Select aria-label="从模板创建" allowClear value={templateId} placeholder="选择预置或自定义模板" options={templates.map(template => ({ value: template.id, label: template.name }))} onChange={id => {
            setTemplateId(id);
            const template = templates.find(item => item.id === id);
            if (!template) { setTemplateChecklist([]); return; }
            setTemplateChecklist(template.checklist);
            form.setFieldsValue({ title: template.name, description: template.description, phase: template.defaultPhase, priority: template.defaultPriority, resources: template.suggestedResources, status: "todo", progress: 0 });
          }} />
          {templateChecklist.length > 0 && <div className="template-checklist-preview">将生成 {templateChecklist.length} 个检查项：{templateChecklist.join("、")}</div>}
        </Form.Item>}
        <Form.Item
          name="title"
          label="任务标题"
          rules={[{ required: true, message: "请输入任务标题" }]}
        >
          <Input placeholder="例如：掌握 Function Calling" maxLength={80} />
        </Form.Item>

        <Row gutter={12}>
          <Col span={12}>
            <Form.Item name="category" label="分类">
              <Input placeholder="基础概念 / 工具链 / 实战…" />
            </Form.Item>
          </Col>
          <Col span={12}>
            <Form.Item name="priority" label="优先级">
              <Select options={PRIORITY_OPTIONS} />
            </Form.Item>
          </Col>
        </Row>

        <Form.Item name="dependencyIds" label="前置任务" extra="任一前置任务未完成时，本任务会显示为依赖阻塞；不会修改你设置的状态。">
          <Select mode="multiple" allowClear showSearch optionFilterProp="label" placeholder="选择多个前置任务" options={dependencies.map(item => ({ value: item.id, label: `${item.title}${item.status === "done" ? "（已完成）" : ""}` }))} />
        </Form.Item>

        <Form.Item name="estimatedHours" label="预估工时（小时）" extra="可留空；填写正整数或小数。实际投入由工时记录累计。" rules={[{ validator: (_, value) => value === null || value === undefined || value === "" || value > 0 ? Promise.resolve() : Promise.reject(new Error("预估工时必须大于 0")) }]}>
          <InputNumber step={0.25} style={{ width: "100%" }} placeholder="例如 2.5" />
        </Form.Item>

        <Row gutter={12}>
          <Col span={12}>
            <Form.Item name="status" label="状态">
              <Select options={STATUS_OPTIONS} />
            </Form.Item>
          </Col>
          <Col span={12}>
            <Form.Item name="progress" label="手动进度（无检查项时生效）">
              <InputNumber min={0} max={100} style={{ width: "100%" }} />
            </Form.Item>
          </Col>
        </Row>

        <Row gutter={12}>
          <Col span={12}>
            <Form.Item name="phase" label="学习阶段">
              <Select options={PHASE_OPTIONS} />
            </Form.Item>
          </Col>
          <Col span={12}>
            <Form.Item name="plannedStartDate" label="计划开始日期">
              <DatePicker style={{ width: "100%" }} />
            </Form.Item>
          </Col>
        </Row>
        <Form.Item name="dueDate" label={recurrenceEnabled ? "首次／本次到期时间（上海时间）" : "到期日"}>
          <DatePicker style={{ width: "100%" }} showTime={!!recurrenceEnabled} format={recurrenceEnabled ? "YYYY-MM-DD HH:mm" : "YYYY-MM-DD"} />
        </Form.Item>

        <Form.Item name="recurrenceEnabled" label="重复任务" valuePropName="checked" extra={series && !series.active ? "该重复序列已停止；已有实例保留。" : "到期后自动生成下一次，与本次是否完成无关。"}>
          <Switch disabled={!!series && !series.active} />
        </Form.Item>
        {recurrenceEnabled && <>
          <Row gutter={12}>
            <Col span={12}><Form.Item name="recurrenceFrequency" label="频率"><Select options={[{ value: "daily", label: "每天" }, { value: "weekly", label: "每周" }, { value: "monthly", label: "每月" }]} /></Form.Item></Col>
            <Col span={12}><Form.Item name="recurrenceInterval" label="间隔" rules={[{ required: true, message: "请输入重复间隔" }]}><InputNumber min={1} max={365} precision={0} style={{ width: "100%" }} /></Form.Item></Col>
          </Row>
          <Form.Item name="recurrenceEndType" label="截止条件"><Select options={[{ value: "never", label: "无限" }, { value: "count", label: "次数上限（含本次）" }, { value: "date", label: "截止日期" }]} /></Form.Item>
          {recurrenceEndType === "count" && <Form.Item name="recurrenceEndCount" label="最多重复次数" rules={[{ required: true, message: "请输入次数上限" }]}><InputNumber min={1} precision={0} style={{ width: "100%" }} /></Form.Item>}
          {recurrenceEndType === "date" && <Form.Item name="recurrenceEndDate" label="截止日期（含当天）" rules={[{ required: true, message: "请选择截止日期" }]}><DatePicker style={{ width: "100%" }} /></Form.Item>}
          {series && <Form.Item name="syncFuture" label="将本次任务字段同步到后续实例" valuePropName="checked" extra="默认只修改本次。开启后，标题、描述等复制字段将用于以后生成的任务。"><Switch /></Form.Item>}
        </>}

        <Form.Item name="description" label="任务描述">
          <Input.TextArea rows={2} placeholder="这条学习任务要解决什么？" />
        </Form.Item>

        {!initial && <Form.Item name="tags" label="任务标签">
          <Select mode="tags" options={PRESET_TASK_TAGS.map(tag => ({ value: tag, label: tag }))} placeholder="选择或输入标签" tokenSeparators={[","]} />
        </Form.Item>}

        <Form.Item name="notes" label="学习笔记">
          <Input.TextArea rows={3} placeholder="记录学习过程中的要点与心得" />
        </Form.Item>

        <Form.Item label="学习资料">
          <Form.List name="resources">
            {(fields, { add, remove }) => (
              <Space direction="vertical" size={8} style={{ width: "100%" }}>
                {fields.map((field) => (
                  <div key={field.key} className="resource-row">
                    <Form.Item
                      name={[field.name, "label"]}
                      noStyle
                      rules={[{ required: true, message: "名称必填" }]}
                    >
                      <Input className="resource-name" placeholder="资料名称" aria-label="资料名称" />
                    </Form.Item>
                    <Form.Item name={[field.name, "url"]} noStyle>
                      <Input className="resource-url" placeholder="https://…" aria-label="资料链接" />
                    </Form.Item>
                    <Button
                      type="text"
                      danger
                      icon={<DeleteOutlined />}
                      aria-label="删除该学习资料"
                      onClick={() => remove(field.name)}
                    />
                  </div>
                ))}
                <Button
                  type="dashed"
                  block
                  icon={<PlusOutlined />}
                  onClick={() => add({ label: "", url: "" })}
                >
                  添加资料
                </Button>
              </Space>
            )}
          </Form.List>
        </Form.Item>
      </Form>
    </Drawer>
  );
}
