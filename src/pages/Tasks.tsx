import { useSettings } from "../components/SettingsProvider";
import { useCallback, useEffect, useMemo, useRef, useState, type SetStateAction } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import {
  App,
  Button,
  Card,
  Checkbox,
  DatePicker,
  Dropdown,
  Input,
  Popover,
  Popconfirm,
  Progress,
  Segmented,
  Select,
  Spin,
  Space,
  Table,
  Tag,
  Typography,
} from "antd";
import {
  DeleteOutlined,
  DownloadOutlined,
  HistoryOutlined,
  PlusOutlined,
  UploadOutlined,
  SettingOutlined,
  ArrowUpOutlined,
  ArrowDownOutlined,
} from "@ant-design/icons";
import type { ColumnsType } from "antd/es/table";
import dayjs from "dayjs";
import { ApiError, getStoredUser } from "../api/client";
import { bulkTasks, deleteTask, importTasks, listTasks, patchTask } from "../api/tasks";
import TaskCsvImport from "../components/TaskCsvImport";
import TaskFormDrawer from "../components/TaskFormDrawer";
import TaskGantt from "../components/TaskGantt";
import TaskKanban from "../components/TaskKanban";
import {
  PHASE_OPTIONS,
  PRIORITY_OPTIONS,
  PriorityTag,
  STATUS_OPTIONS,
  StatusTag,
} from "../components/TaskMeta";
import type {
  LearningTask,
  BulkTaskField,
  BulkTaskResult,
  TaskPriority,
  TaskQuery,
  TaskStatus,
  AuthUser,
  RecurringSeries,
} from "../types";
import { exportFields, exportTaskCsv } from "../utils/taskCsv";
import { COLUMN_LABELS, MOVABLE_COLUMNS, normalizeColumnConfig, nextTaskSort, readTaskQuery, readTaskSort, sortTasks, writeTaskParams, type TaskColumnConfig, type TaskColumnKey, type TaskSortKey } from "../utils/taskTable";
import { markdownSummary } from "../utils/markdown-summary";

function download(filename: string, content: string | Blob, type: string) {
  const blob = content instanceof Blob ? content : new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

function toMarkdown(tasks: LearningTask[]): string {
  const lines = ["# 学习任务清单", ""];
  for (const t of tasks) {
    lines.push(`## ${t.title}`);
    lines.push(
      `- 分类：${t.category}　阶段：${t.phase}　状态：${t.status}　优先级：${t.priority}　进度：${t.progress}%`
    );
    if (t.dueDate) lines.push(`- 到期：${t.dueDate.slice(0, 10)}`);
    if (t.description) lines.push(`- 描述：${t.description}`);
    if (t.notes) lines.push(`- 笔记：${t.notes}`);
    lines.push("");
  }
  return lines.join("\n");
}

function highlighted(value: string, keyword: string) {
  const needle = keyword.trim();
  if (!needle) return value;
  const lower = value.toLocaleLowerCase();
  const match = needle.toLocaleLowerCase();
  const parts: React.ReactNode[] = [];
  let offset = 0;
  let index = lower.indexOf(match, offset);
  while (index >= 0) {
    if (index > offset) parts.push(value.slice(offset, index));
    parts.push(<mark key={index}>{value.slice(index, index + needle.length)}</mark>);
    offset = index + needle.length;
    index = lower.indexOf(match, offset);
  }
  if (offset < value.length) parts.push(value.slice(offset));
  return parts;
}

function noteExcerpt(notes: string, keyword: string) {
  const plain = markdownSummary(notes, Number.MAX_SAFE_INTEGER);
  const index = plain.toLocaleLowerCase().indexOf(keyword.trim().toLocaleLowerCase());
  if (index < 0) return "";
  const start = Math.max(0, index - 28);
  const end = Math.min(plain.length, index + keyword.trim().length + 48);
  return `${start ? "…" : ""}${plain.slice(start, end)}${end < plain.length ? "…" : ""}`;
}

export default function Tasks() {
  const { pageSize } = useSettings();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { message, modal } = App.useApp();
  const [items, setItems] = useState<LearningTask[]>([]);
  const [recurringSeries, setRecurringSeries] = useState<Record<string, RecurringSeries>>({});
  const [loading, setLoading] = useState(true);
  const querySignature = ["keyword", "status", "category", "phase"].map(key => searchParams.get(key) || "").join("\0") + "\0" + searchParams.getAll("tag").join("\0");
  const query = useMemo(() => readTaskQuery(searchParams), [querySignature]);
  const sortRules = useMemo(() => readTaskSort(searchParams), [searchParams.get("sort")]);
  const setQuery = useCallback((update: SetStateAction<TaskQuery>) => setSearchParams(previous => {
    const current = readTaskQuery(previous);
    return writeTaskParams(previous, typeof update === "function" ? update(current) : update, readTaskSort(previous));
  }, { replace: true }), [setSearchParams]);
  const setSortRules = useCallback((sort: ReturnType<typeof readTaskSort>) => setSearchParams(previous => writeTaskParams(previous, readTaskQuery(previous), sort), { replace: true }), [setSearchParams]);
  const [searchText, setSearchText] = useState(() => searchParams.get("keyword") || "");
  const [categories, setCategories] = useState<string[]>([]);
  const [availableTags, setAvailableTags] = useState<string[]>([]);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [editing, setEditing] = useState<LearningTask | null>(null);
  const [view, setView] = useState<"table" | "gantt" | "kanban">("table");
  const [selectedKeys, setSelectedKeys] = useState<string[]>([]);
  const [bulkField, setBulkField] = useState<BulkTaskField>("status");
  const [bulkValue, setBulkValue] = useState("");
  const [bulkBusy, setBulkBusy] = useState(false);
  const [csvOpen, setCsvOpen] = useState(false);
  const [pdfBusy, setPdfBusy] = useState(false);
  const accountId = getStoredUser<AuthUser>()?.id || "anonymous";
  const columnStorageKey = `admin-task-columns-v1:${accountId}`;
  const [columnConfig, setColumnConfig] = useState<TaskColumnConfig>(() => {
    try { return normalizeColumnConfig(JSON.parse(localStorage.getItem(columnStorageKey) || "null")); }
    catch { return normalizeColumnConfig(null); }
  });
  const fileRef = useRef<HTMLInputElement>(null);
  const requestId = useRef(0);

  useEffect(() => {
    requestId.current++;
    if (!searchText.trim()) {
      setQuery(previous => previous.keyword ? { ...previous, keyword: "" } : previous);
      return;
    }
    const timer = window.setTimeout(() => setQuery(previous => previous.keyword === searchText.trim() ? previous : { ...previous, keyword: searchText.trim() }), 300);
    return () => window.clearTimeout(timer);
  }, [searchText]);

  useEffect(() => { setSearchText(query.keyword || ""); }, [query.keyword]);
  useEffect(() => { try { localStorage.setItem(columnStorageKey, JSON.stringify(columnConfig)); } catch { /* storage may be unavailable */ } }, [columnConfig, columnStorageKey]);

  useEffect(() => { setSelectedKeys([]); }, [query]);

  useEffect(() => {
    if (searchParams.get("create") !== "1") return;
    setEditing(null);
    setDrawerOpen(true);
    setSearchParams(previous => { const next = new URLSearchParams(previous); next.delete("create"); return next; }, { replace: true });
  }, [searchParams, setSearchParams]);

  const refresh = useCallback(
    async (q: TaskQuery) => {
      const currentRequest = ++requestId.current;
      setLoading(true);
      try {
        const res = await listTasks(q);
        if (currentRequest !== requestId.current) return;
        setItems(res.items);
        setRecurringSeries(res.recurringSeries || {});
        setCategories(res.categories);
        setAvailableTags(res.tags);
      } catch (err) {
        if (currentRequest === requestId.current) message.error(err instanceof Error ? err.message : "加载任务失败");
      } finally {
        if (currentRequest === requestId.current) setLoading(false);
      }
    },
    [message]
  );

  useEffect(() => {
    void refresh(query);
  }, [query, refresh]);

  const openCreate = () => {
    setEditing(null);
    setDrawerOpen(true);
  };
  const openEdit = (task: LearningTask) => {
    setEditing(task);
    setDrawerOpen(true);
  };
  const handleSaved = () => {
    setDrawerOpen(false);
    void refresh(query);
  };

  const toggleDone = async (task: LearningTask) => {
    try {
      if (task.status === "done") {
        await patchTask(task.id, { status: "in_progress" });
        message.success("已重新打开");
      } else {
        await patchTask(task.id, { status: "done", progress: 100 });
        message.success("已标记完成");
      }
      void refresh(query);
    } catch (err) {
      message.error(err instanceof Error ? err.message : "操作失败");
    }
  };

  const remove = async (task: LearningTask) => {
    try {
      await deleteTask(task.id);
      message.success("已删除");
      void refresh(query);
    } catch (err) {
      message.error(err instanceof Error ? err.message : "删除失败");
    }
  };

  const sortedItems = useMemo(() => sortTasks(items, sortRules), [items, sortRules]);
  const visibleColumnKeys = useMemo<TaskColumnKey[]>(() => ["title", ...columnConfig.order.filter(key => !columnConfig.hidden.includes(key)), "actions"], [columnConfig]);
  const allIds = useMemo(() => sortedItems.map(task => task.id), [sortedItems]);
  const selectedSet = useMemo(() => new Set(selectedKeys), [selectedKeys]);
  const moveColumn = (key: TaskColumnKey, target: TaskColumnKey) => setColumnConfig(previous => {
    if (!MOVABLE_COLUMNS.includes(key) || !MOVABLE_COLUMNS.includes(target) || key === target) return previous;
    const order = previous.order.filter(item => item !== key);
    order.splice(order.indexOf(target), 0, key);
    return { ...previous, order };
  });
  const shiftColumn = (key: TaskColumnKey, delta: number) => setColumnConfig(previous => {
    const index = previous.order.indexOf(key);
    const target = index + delta;
    if (index < 0 || target < 0 || target >= previous.order.length) return previous;
    const order = [...previous.order];
    [order[index], order[target]] = [order[target], order[index]];
    return { ...previous, order };
  });
  const exportPdf = async () => {
    setPdfBusy(true);
    try {
      const { makeTaskPdf } = await import("../utils/taskPdf");
      const result = await makeTaskPdf(sortedItems);
      download("learning-tasks-report.pdf", result.blob, "application/pdf");
      message.success(`PDF 已生成：${sortedItems.length} 条任务，耗时 ${result.durationMs} ms`);
    } catch (error) { message.error(error instanceof Error ? error.message : "PDF 导出失败"); }
    finally { setPdfBusy(false); }
  };
  const runBulk = async (action: "update" | "delete") => {
    const selected = items.filter(task => selectedSet.has(task.id));
    if (!selected.length || bulkBusy) return;
    const ids = selected.map(task => task.id);
    const versions = Object.fromEntries(selected.map(task => [task.id, task.version]));
    setBulkBusy(true);
    try {
      const changes = action === "update" ? { [bulkField]: bulkValue } : undefined;
      const result = await bulkTasks(ids, versions, action, changes);
      message.success(`成功 ${result.successCount} / 失败 ${result.failedCount}`);
      setSelectedKeys([]);
      await refresh(query);
    } catch (error) {
      const result = error instanceof ApiError ? error.payload as BulkTaskResult | null : null;
      const detail = result?.errors?.map(item => `${selected.find(task => task.id === item.taskId)?.title || item.taskId}：${item.reason}`).join("；");
      message.error(`成功 ${result?.successCount ?? 0} / 失败 ${result?.failedCount ?? ids.length}${detail ? `；${detail}` : `；${error instanceof Error ? error.message : "操作失败"}`}`, 8);
    } finally {
      setBulkBusy(false);
    }
  };

  const handleImportFile = async (file: File) => {
    try {
      const text = await file.text();
      const parsed = JSON.parse(text) as unknown;
      const arr = Array.isArray(parsed)
        ? parsed
        : (parsed as { tasks?: unknown[] }).tasks;
      if (!Array.isArray(arr)) {
        message.error("JSON 格式不正确：应为任务数组或 { tasks: [] }");
        return;
      }
      const res = await importTasks(arr);
      message.success(`已导入 ${res.added} 条任务`);
      void refresh(query);
    } catch (err) {
      message.error(err instanceof Error ? err.message : "导入失败");
    }
  };

  const sortHeader = (label: string, key: TaskSortKey) => {
    const index = sortRules.findIndex(item => item.key === key);
    const direction = index < 0 ? "" : sortRules[index].direction;
    return <button type="button" className="task-sort-header" aria-label={`${label}排序；按 Shift 可叠加优先级与截止日期`} onClick={event => setSortRules(nextTaskSort(sortRules, key, event.shiftKey))}>{label}<span aria-hidden="true">{direction === "asc" ? " ↑" : direction === "desc" ? " ↓" : " ↕"}{sortRules.length > 1 && index >= 0 ? index + 1 : ""}</span></button>;
  };
  const columns: ColumnsType<LearningTask> = [
    {
      title: "任务",
      dataIndex: "title",
      key: "title",
      render: (_, task) => (
        <Space direction="vertical" size={0}>
          <Link className="task-title-link" to={`/tasks/${task.id}`}>{task.recurringSeriesId ? "🔄 " : ""}{highlighted(task.title, query.keyword || "")}{task.recurringSeriesId ? ` · 第 ${task.recurrenceIndex || 1} 次` : ""}</Link>
          {task.description && (
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              {highlighted(markdownSummary(task.description), query.keyword || "")}
            </Typography.Text>
          )}
          {!!query.keyword && !`${task.title} ${task.description || ""}`.toLocaleLowerCase().includes(query.keyword.toLocaleLowerCase()) && !!task.notes && <Typography.Text type="secondary" style={{ fontSize: 12 }}>笔记：{highlighted(noteExcerpt(task.notes, query.keyword), query.keyword)}</Typography.Text>}
          {task.tags?.length > 0 && <Space size={2} wrap>{task.tags.map(tag => <Tag key={tag}>{tag}</Tag>)}</Space>}
        </Space>
      ),
    },
    {
      title: "分类",
      dataIndex: "category",
      key: "category",
      width: 100,
      render: (value: string) => <Tag>{value}</Tag>,
    },
    {
      title: "阶段",
      dataIndex: "phase",
      key: "phase",
      width: 80,
      render: (value: string) => <Tag color="geekblue">{value}</Tag>,
    },
    {
      title: "状态",
      dataIndex: "effectiveStatus",
      key: "status",
      width: 90,
      render: (value: TaskStatus, task) => <Space direction="vertical" size={0}><StatusTag status={value} />{task.blockedBy.length > 0 && <Typography.Text type="secondary" style={{ fontSize: 11 }}>依赖阻塞 · {task.blockedBy.length} 项</Typography.Text>}</Space>,
    },
    {
      title: sortHeader("优先级", "priority"),
      dataIndex: "priority",
      key: "priority",
      width: 80,
      render: (value: TaskPriority) => <PriorityTag priority={value} />,
    },
    {
      title: sortHeader("进度", "progress"),
      dataIndex: "progress",
      key: "progress",
      width: 130,
      render: (value: number) => <Progress percent={value} size="small" />,
    },
    {
      title: sortHeader("到期", "dueDate"),
      dataIndex: "dueDate",
      key: "dueDate",
      width: 110,
      render: (value: string, task) => {
        if (!value) return <Typography.Text type="secondary">-</Typography.Text>;
        const todayKey = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Shanghai" });
        const dueKey = /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : new Date(value).toLocaleDateString("en-CA", { timeZone: "Asia/Shanghai" });
        const overdue = task.status !== "done" && dueKey < todayKey;
        return (
          <Space size={4}>
            <span style={{ color: overdue ? "#ec929f" : undefined, whiteSpace: "nowrap" }}>
              {dueKey}
            </span>
            {overdue && <Tag color="error">逾期</Tag>}
          </Space>
        );
      },
    },
    {
      title: sortHeader("创建时间", "createdAt"),
      dataIndex: "createdAt",
      key: "createdAt",
      width: 125,
      render: (value: string) => new Date(value).toLocaleDateString("en-CA", { timeZone: "Asia/Shanghai" }),
    },
    {
      title: "操作",
      key: "actions",
      width: 220,
      render: (_, task) => (
        <Space size={4}>
          <Button type="link" size="small" onClick={() => openEdit(task)}>
            编辑
          </Button>
          <Button type="link" size="small" onClick={() => void toggleDone(task)}>
            {task.status === "done" ? "重开" : "完成"}
          </Button>
          <Button
            type="link"
            size="small"
            icon={<HistoryOutlined />}
            onClick={() => navigate(`/tasks/${task.id}?tab=history`)}
          >
            历史
          </Button>
          <Popconfirm
            title="删除该学习任务？"
            okText="删除"
            cancelText="取消"
            onConfirm={() => void remove(task)}
          >
            <Button type="link" size="small" danger>
              删除
            </Button>
          </Popconfirm>
        </Space>
      ),
    },
  ];

  const visibleColumns = visibleColumnKeys.map(key => columns.find(column => column.key === key)!).filter(Boolean);

  const categoryOptions = useMemo(
    () => categories.map((c) => ({ value: c, label: c })),
    [categories]
  );

  const columnControls = <Space direction="vertical" size={6} style={{ width: 260 }}>
    <Typography.Text strong>显示与顺序</Typography.Text>
    <Typography.Text type="secondary" style={{ fontSize: 12 }}>拖动行调整；任务、操作及选择列固定。</Typography.Text>
    {columnConfig.order.map((key, index) => <div key={key} className="task-column-setting" draggable onDragStart={event => event.dataTransfer.setData("text/plain", key)} onDragOver={event => event.preventDefault()} onDrop={event => { event.preventDefault(); moveColumn(event.dataTransfer.getData("text/plain") as TaskColumnKey, key); }}>
      <span aria-hidden="true" className="task-column-handle">⋮⋮</span>
      <Checkbox checked={!columnConfig.hidden.includes(key)} onChange={event => setColumnConfig(previous => ({ ...previous, hidden: event.target.checked ? previous.hidden.filter(item => item !== key) : [...previous.hidden, key] }))}>{COLUMN_LABELS[key]}</Checkbox>
      <Button type="text" size="small" aria-label={`上移${COLUMN_LABELS[key]}`} icon={<ArrowUpOutlined />} disabled={index === 0} onClick={() => shiftColumn(key, -1)} />
      <Button type="text" size="small" aria-label={`下移${COLUMN_LABELS[key]}`} icon={<ArrowDownOutlined />} disabled={index === columnConfig.order.length - 1} onClick={() => shiftColumn(key, 1)} />
    </div>)}
    <Button size="small" onClick={() => setColumnConfig(normalizeColumnConfig(null))}>恢复默认列</Button>
  </Space>;

  return (
    <Card className="collection-card" title={<span className="collection-title">任务列表<span className="collection-count">{items.length} 条</span></span>}>
      <Space className="collection-toolbar" wrap size={[10, 12]}>
        <Segmented aria-label="任务视图" value={view} onChange={value => { const next = value as "table" | "gantt" | "kanban"; setView(next); if (next === "kanban") setQuery(previous => ({ ...previous, status: "" })); }} options={[{ label: "列表", value: "table" }, { label: "甘特图", value: "gantt" }, { label: "看板", value: "kanban" }]} />
        <Input.Search
          placeholder="搜索标题 / 描述 / 笔记"
          allowClear
          style={{ width: 240 }}
          value={searchText}
          onSearch={value => setSearchText(value)}
          onChange={event => setSearchText(event.target.value)}
        />
        {view !== "kanban" && <Select
          placeholder="状态"
          allowClear
          style={{ width: 110 }}
          options={STATUS_OPTIONS}
          value={query.status || undefined}
          onChange={(value) =>
            setQuery((prev) => ({
              ...prev,
              status: (value ?? "") as TaskStatus | "",
            }))
          }
        />}
        <Select
          placeholder="阶段"
          allowClear
          style={{ width: 110 }}
          options={PHASE_OPTIONS}
          value={query.phase || undefined}
          onChange={(value) => setQuery((prev) => ({ ...prev, phase: value }))}
        />
        <Select
          placeholder="分类"
          allowClear
          style={{ width: 130 }}
          options={categoryOptions}
          value={query.category || undefined}
          onChange={(value) => setQuery((prev) => ({ ...prev, category: value }))}
        />
        <Select mode="multiple" aria-label="标签筛选，全部匹配" placeholder="标签筛选（全部匹配）" allowClear style={{ minWidth: 180, maxWidth: 300 }} value={query.tags || []} options={availableTags.map(tag => ({ value: tag, label: tag }))} onChange={tags => setQuery(previous => ({ ...previous, tags }))} />
        <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>
          新建任务
        </Button>
        <Dropdown menu={{ items: [{ key: "json", label: "导入 JSON" }, { key: "csv", label: "导入 CSV" }], onClick: ({ key }) => key === "json" ? fileRef.current?.click() : setCsvOpen(true) }}><Button icon={<UploadOutlined />}>导入</Button></Dropdown>
        <Dropdown menu={{ items: [
          { key: "json", label: "导出 JSON" }, { key: "md", label: "导出 Markdown" },
          { key: "csv-all", label: "导出 CSV · 全部字段" }, { key: "csv-visible", label: "导出 CSV · 当前可见列" },
          { key: "pdf", label: "导出 PDF 报告" },
        ], onClick: ({ key }) => {
          if (key === "json") download("learning-tasks.json", JSON.stringify(sortedItems, null, 2), "application/json");
          if (key === "md") download("learning-tasks.md", toMarkdown(sortedItems), "text/markdown");
          if (key === "csv-all" || key === "csv-visible") download("learning-tasks.csv", exportTaskCsv(sortedItems, exportFields(key === "csv-visible", visibleColumnKeys), recurringSeries), "text/csv;charset=utf-8");
          if (key === "pdf") void exportPdf();
        } }}><Button icon={<DownloadOutlined />} loading={pdfBusy}>导出</Button></Dropdown>
        <Popover trigger="click" placement="bottomRight" content={columnControls}><Button icon={<SettingOutlined />} aria-label="设置表格列">列设置</Button></Popover>
        <input
          ref={fileRef}
          type="file"
          accept=".json,application/json"
          style={{ display: "none" }}
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) void handleImportFile(file);
            e.target.value = "";
          }}
        />
      </Space>

      {view === "table" && <Space className="task-selection-tools" wrap>
        <Button size="small" disabled={loading || bulkBusy || !allIds.length} onClick={() => setSelectedKeys(allIds)}>全选当前筛选（{allIds.length}）</Button>
        <Button size="small" disabled={loading || bulkBusy || !allIds.length} onClick={() => setSelectedKeys(allIds.filter(id => !selectedSet.has(id)))}>反选</Button>
        <Typography.Text type="secondary">已选 {selectedKeys.length} 条</Typography.Text>
      </Space>}

      {view === "table" ? <Table
        rowKey="id"
        loading={loading}
        columns={visibleColumns}
        dataSource={sortedItems}
        rowSelection={{
          selectedRowKeys: selectedKeys,
          preserveSelectedRowKeys: true,
          onChange: keys => setSelectedKeys(keys.map(String)),
          columnTitle: <Checkbox aria-label="全选当前筛选任务" disabled={bulkBusy || !allIds.length} checked={allIds.length > 0 && selectedKeys.length === allIds.length} indeterminate={selectedKeys.length > 0 && selectedKeys.length < allIds.length} onChange={event => setSelectedKeys(event.target.checked ? allIds : [])} />,
          getCheckboxProps: () => ({ disabled: bulkBusy }),
        }}
        scroll={{ x: 1100 }}
        pagination={{ pageSize, showSizeChanger: false }}
      /> : view === "gantt" ? <Spin spinning={loading}><TaskGantt tasks={sortedItems} onRefresh={() => refresh(query)} /></Spin> : <Spin spinning={loading}><TaskKanban tasks={sortedItems} onRefresh={() => refresh(query)} /></Spin>}

      {view === "table" && selectedKeys.length > 0 && <div className="task-bulk-bar" role="region" aria-label="批量操作">
        <Space wrap size={8}>
          <strong>已选 {selectedKeys.length} 条</strong>
          <Select aria-label="批量修改字段" style={{ width: 110 }} value={bulkField} disabled={bulkBusy} onChange={field => { setBulkField(field); setBulkValue(""); }} options={[
            { value: "status", label: "状态" }, { value: "category", label: "分类" }, { value: "phase", label: "阶段" }, { value: "priority", label: "优先级" }, { value: "dueDate", label: "到期日期" },
          ]} />
          {bulkField === "status" && <Select aria-label="批量状态" style={{ width: 120 }} placeholder="选择状态" value={bulkValue || undefined} disabled={bulkBusy} options={STATUS_OPTIONS} onChange={setBulkValue} />}
          {bulkField === "priority" && <Select aria-label="批量优先级" style={{ width: 110 }} placeholder="选择优先级" value={bulkValue || undefined} disabled={bulkBusy} options={PRIORITY_OPTIONS} onChange={setBulkValue} />}
          {bulkField === "phase" && <Select aria-label="批量阶段" style={{ width: 110 }} placeholder="选择阶段" value={bulkValue || undefined} disabled={bulkBusy} options={PHASE_OPTIONS} onChange={setBulkValue} />}
          {bulkField === "category" && <Input aria-label="批量分类" style={{ width: 160 }} placeholder="输入分类" value={bulkValue} disabled={bulkBusy} onChange={event => setBulkValue(event.target.value)} />}
          {bulkField === "dueDate" && <DatePicker aria-label="批量到期日期" style={{ width: 150 }} placeholder="清空表示移除日期" value={bulkValue ? dayjs(bulkValue) : null} disabled={bulkBusy} onChange={date => setBulkValue(date ? date.format("YYYY-MM-DD") : "")} />}
          <Button type="primary" disabled={bulkBusy || (bulkField !== "dueDate" && !bulkValue.trim())} onClick={() => void runBulk("update")}>应用修改</Button>
          <Button danger icon={<DeleteOutlined />} disabled={bulkBusy} onClick={() => modal.confirm({ title: `确定删除 ${selectedKeys.length} 个任务？`, content: "删除后无法恢复任务。", okText: "确定删除", okType: "danger", cancelText: "取消", onOk: () => runBulk("delete") })}>批量删除</Button>
          <Button disabled={bulkBusy} onClick={() => setSelectedKeys([])}>取消选择</Button>
          {bulkBusy && <span className="task-bulk-progress" role="status"><Spin size="small" /> 正在校验并提交 {selectedKeys.length} 条任务…</span>}
        </Space>
      </div>}

      <TaskFormDrawer
        open={drawerOpen}
        initial={editing}
        onClose={() => setDrawerOpen(false)}
        onSaved={handleSaved}
      />
      <TaskCsvImport open={csvOpen} onClose={() => setCsvOpen(false)} onImported={() => void refresh(query)} />
    </Card>
  );
}
