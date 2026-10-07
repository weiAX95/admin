import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  App,
  Button,
  Card,
  Drawer,
  Form,
  Input,
  Popconfirm,
  Select,
  Space,
  Table,
  Tag,
  Tree,
  Typography,
} from "antd";
import { PlusOutlined, ApartmentOutlined, SettingOutlined } from "@ant-design/icons";
import { Link } from "react-router-dom";
import type { ColumnsType } from "antd/es/table";
import { createNote, deleteNote, listNoteCategories, listNoteTags, listNotes, updateNote } from "../api/notes";
import { listTasks } from "../api/tasks";
import type { AuthUser, LearningTask, Note, NoteCategory, NotePayload, NoteTagDefinition } from "../types";
import { getStoredUser } from "../api/client";
import MarkdownEditor from "../components/MarkdownEditor";
import NoteCategoryManager, { categoryPath } from "../components/NoteCategoryManager";
import NoteTagManager, { type NoteTagChange } from "../components/NoteTagManager";
import { markdownSummary } from "../utils/markdown-summary";
import { downloadBlob, notesZip } from "../utils/noteExport";
import { NOTE_TEMPLATES } from "../utils/noteTemplates";

interface Props {
  open: boolean;
  initial: Note | null;
  tasks: LearningTask[];
  notes?: Note[];
  categories?: NoteCategory[];
  defaultTaskId?: string;
  prefill?: Partial<NotePayload>;
  suppressSuccess?: boolean;
  onClose: () => void;
  onSaved: (note: Note) => void;
}
const EMPTY_NOTES: Note[] = [];
const EMPTY_CATEGORIES: NoteCategory[] = [];
type CategoryTreeNode = { key: string; title: string; children: CategoryTreeNode[] };

export function NoteFormDrawer({ open, initial, tasks, notes = EMPTY_NOTES, categories = EMPTY_CATEGORIES, defaultTaskId, prefill, suppressSuccess = false, onClose, onSaved }: Props) {
  const [form] = Form.useForm<NotePayload>();
  const [saving, setSaving] = useState(false);
  const [selectedTemplate, setSelectedTemplate] = useState<string | undefined>();
  const [catalogue, setCatalogue] = useState<Note[]>([]);
  const [categoryCatalogue, setCategoryCatalogue] = useState<NoteCategory[]>([]);
  const [tagCatalogue, setTagCatalogue] = useState<NoteTagDefinition[]>([]);
  const { message } = App.useApp();

  useEffect(() => {
    if (!open) return;
    if (notes.length) { setCatalogue(notes); return; }
    let alive = true;
    listNotes().then(result => { if (alive) setCatalogue(result.items); }).catch(() => { if (alive) setCatalogue([]); });
    return () => { alive = false; };
  }, [open, notes]);
  useEffect(() => {
    if (!open) return;
    let alive = true;
    listNoteTags().then(result => { if (alive) setTagCatalogue(result.items); }).catch(() => { if (alive) setTagCatalogue([]); });
    return () => { alive = false; };
  }, [open]);
  useEffect(() => {
    if (!open) return;
    if (categories.length) { setCategoryCatalogue(categories); return; }
    let alive = true;
    listNoteCategories().then(result => { if (alive) setCategoryCatalogue(result.items); }).catch(() => { if (alive) setCategoryCatalogue([]); });
    return () => { alive = false; };
  }, [open, categories]);

  useEffect(() => {
    if (!open) return;
    form.resetFields();
    setSelectedTemplate(undefined);
    if (initial) form.setFieldsValue(initial);
    else form.setFieldsValue({ title: "", content: "", taskId: defaultTaskId || null, categoryId: null, tags: [], ...prefill });
  }, [open, initial, defaultTaskId, prefill, form]);

  const handleFinish = async (values: NotePayload) => {
    setSaving(true);
    try {
      const payload = { ...values, taskId: values.taskId || null, categoryId: values.categoryId || null };
      const saved = initial ? await updateNote(initial.id, payload) : await createNote(payload);
      if (!suppressSuccess) message.success(initial ? "已更新笔记" : "已创建笔记");
      onSaved(saved);
    } catch (err) {
      message.error(err instanceof Error ? err.message : "保存失败");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Drawer
      title={initial ? "编辑笔记" : "新建笔记"}
      width="min(1050px, 100vw)"
      open={open}
      onClose={onClose}
      extra={
        <Button type="primary" loading={saving} onClick={() => form.submit()}>
          保存
        </Button>
      }
    >
      <Form form={form} layout="vertical" onFinish={handleFinish}>
        {!initial && <Form.Item label="笔记模板"><Select allowClear disabled={Boolean(prefill?.content)} value={selectedTemplate} placeholder={prefill?.content ? "已有预填内容" : "从模板开始（可选）"} options={NOTE_TEMPLATES.map(item => ({ value: item.id, label: item.name }))} onChange={value => {
          const previousContent = NOTE_TEMPLATES.find(item => item.id === selectedTemplate)?.content;
          const currentContent = form.getFieldValue("content");
          setSelectedTemplate(value);
          const template = NOTE_TEMPLATES.find(item => item.id === value);
          if (template && (!currentContent || currentContent === previousContent)) form.setFieldsValue({ content: template.content });
        }} /></Form.Item>}
        <Form.Item name="sourceSessionId" hidden><Input type="hidden" /></Form.Item>
        <Form.Item
          name="title"
          label="标题"
          rules={[{ required: true, message: "请输入标题" }]}
        >
          <Input maxLength={60} placeholder="笔记标题" />
        </Form.Item>
        <Form.Item name="taskId" label="关联学习任务">
          <Select
            allowClear
            placeholder="不关联则为独立笔记"
            options={tasks.map((t) => ({ value: t.id, label: t.title }))}
          />
        </Form.Item>
        <Form.Item name="categoryId" label="分类">
          <Select allowClear placeholder="选择分类（可选）" options={categoryCatalogue.map(item => ({ value: item.id, label: categoryPath(item.id, categoryCatalogue) }))} />
        </Form.Item>
        <Form.Item name="tags" label="标签">
          <Select mode="tags" tokenSeparators={[","]} placeholder="输入标签后回车，可添加多个" options={tagCatalogue.map(tag => ({ value: tag.name, label: tag.count ? `${tag.name} · ${tag.count} 篇` : tag.name }))} />
        </Form.Item>
        <Form.Item name="content" label="内容">
          <MarkdownEditor rows={16} notes={catalogue} enableWikiLinks placeholder="学习笔记内容，支持 Markdown 和 [[笔记标题]] 引用" />
        </Form.Item>
      </Form>
    </Drawer>
  );
}

export default function Notes() {
  const { message } = App.useApp();
  const [items, setItems] = useState<Note[]>([]);
  const [categories, setCategories] = useState<NoteCategory[]>([]);
  const [tagDefinitions, setTagDefinitions] = useState<NoteTagDefinition[]>([]);
  const [tagCloud, setTagCloud] = useState<{ name: string; count: number }[]>([]);
  const [tasks, setTasks] = useState<LearningTask[]>([]);
  const [loading, setLoading] = useState(true);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [editing, setEditing] = useState<Note | null>(null);
  const [categoryManagerOpen, setCategoryManagerOpen] = useState(false);
  const [tagManagerOpen, setTagManagerOpen] = useState(false);
  const [exportingZip, setExportingZip] = useState(false);
  const [searchInput, setSearchInput] = useState("");
  const [keyword, setKeyword] = useState("");
  const [categoryId, setCategoryId] = useState<string | null>(null);
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const requestSequence = useRef(0);
  const isAdmin = getStoredUser<AuthUser>()?.role === "admin";

  useEffect(() => {
    if (!searchInput.trim()) { setKeyword(""); return; }
    const timer = window.setTimeout(() => setKeyword(searchInput.trim()), 300);
    return () => window.clearTimeout(timer);
  }, [searchInput]);

  const refreshCategories = useCallback(async () => {
    try {
      const result = await listNoteCategories();
      setCategories(result.items);
      setCategoryId(current => current && !result.items.some(item => item.id === current) ? null : current);
    } catch (error) { message.error(error instanceof Error ? error.message : "加载分类失败"); }
  }, [message]);

  const refreshTags = useCallback(async () => {
    try { setTagDefinitions((await listNoteTags()).items); }
    catch (error) { message.error(error instanceof Error ? error.message : "加载标签失败"); }
  }, [message]);

  const load = useCallback(async () => {
    const sequence = ++requestSequence.current;
    setLoading(true);
    try {
      const res = await listNotes({ keyword, categoryId: categoryId || undefined, tags: selectedTags });
      if (sequence !== requestSequence.current) return;
      setItems(res.items);
      setTagCloud(res.tags);
    } catch (err) {
      if (sequence === requestSequence.current) message.error(err instanceof Error ? err.message : "加载笔记失败");
    } finally {
      if (sequence === requestSequence.current) setLoading(false);
    }
  }, [message, keyword, categoryId, selectedTags]);

  useEffect(() => {
    void load();
  }, [load]);
  useEffect(() => {
    void refreshCategories();
    void refreshTags();
    listTasks({})
      .then((res) => setTasks(res.items))
      .catch(() => setTasks([]));
  }, [refreshCategories, refreshTags]);

  const handleTagChanged = (change: NoteTagChange) => {
    void refreshTags();
    if (change.from && selectedTags.includes(change.from)) {
      setSelectedTags(current => [...new Set(current.map(name => name === change.from ? change.to : name).filter((name): name is string => Boolean(name)))]);
    } else void load();
  };

  const categoryTree = useMemo(() => {
    const branch = (parent: string | null): CategoryTreeNode[] => categories.filter(item => (item.parentId || null) === parent).map(item => ({ key: item.id, title: item.name, children: branch(item.id) }));
    return branch(null);
  }, [categories]);
  const maxTagCount = Math.max(1, ...tagCloud.map(item => item.count));
  const highlight = (value: string) => {
    if (!keyword) return value;
    const lower = value.toLocaleLowerCase();
    const needle = keyword.toLocaleLowerCase();
    const pieces: React.ReactNode[] = [];
    let offset = 0;
    let index = lower.indexOf(needle, offset);
    while (index >= 0) {
      if (index > offset) pieces.push(value.slice(offset, index));
      pieces.push(<mark key={index}>{value.slice(index, index + keyword.length)}</mark>);
      offset = index + keyword.length;
      index = lower.indexOf(needle, offset);
    }
    if (!pieces.length) return value;
    if (offset < value.length) pieces.push(value.slice(offset));
    return <>{pieces}</>;
  };
  const excerpt = (note: Note) => {
    const content = markdownSummary(note.content, Number.MAX_SAFE_INTEGER);
    const index = content.toLocaleLowerCase().indexOf(keyword.toLocaleLowerCase());
    const start = keyword && index > 45 ? index - 35 : 0;
    const end = Math.min(content.length, start + 180);
    return `${start ? "…" : ""}${content.slice(start, end)}${end < content.length ? "…" : ""}`;
  };

  const taskTitle = (id: string | null) =>
    id ? tasks.find((t) => t.id === id)?.title || "已删除任务" : null;

  const remove = async (note: Note) => {
    try {
      await deleteNote(note.id);
      message.success("已删除");
      void load();
      void refreshTags();
    } catch (err) {
      message.error(err instanceof Error ? err.message : "删除失败");
    }
  };

  const exportZip = async () => {
    setExportingZip(true);
    try { downloadBlob(await notesZip(items), `笔记导出-${new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Shanghai" })}.zip`); message.success(`已导出 ${items.length} 篇笔记`); }
    catch (error) { message.error(error instanceof Error ? error.message : "批量导出失败"); }
    finally { setExportingZip(false); }
  };

  const columns: ColumnsType<Note> = [
    {
      title: "标题",
      dataIndex: "title",
      key: "title",
      render: (v: string, note) => <Space direction="vertical" size={0}><Link to={`/notes/${note.id}`}><Typography.Text strong>{highlight(v)}</Typography.Text></Link>{note.content && <Typography.Text type="secondary" className="note-list-excerpt">{highlight(excerpt(note))}</Typography.Text>}</Space>,
    },
    {
      title: "分类",
      dataIndex: "categoryId",
      key: "categoryId",
      width: 170,
      render: (id: string | null) => <Typography.Text type="secondary">{categoryPath(id, categories)}</Typography.Text>,
    },
    {
      title: "标签",
      dataIndex: "tags",
      key: "tags",
      width: 200,
      render: (tags: string[]) => tags?.length ? tags.map(tag => <Tag key={tag}>{tag}</Tag>) : <Typography.Text type="secondary">无标签</Typography.Text>,
    },
    {
      title: "关联任务",
      dataIndex: "taskId",
      key: "taskId",
      width: 220,
      render: (id: string | null) =>
        taskTitle(id) ? <Tag color="geekblue">{taskTitle(id)}</Tag> : <Tag>独立</Tag>,
    },
    {
      title: "来源",
      key: "source",
      width: 110,
      render: (_, n) =>
        n.sourceSessionId ? <Tag color="purple">会话沉淀</Tag> : <Tag>手动</Tag>,
    },
    {
      title: "更新时间",
      dataIndex: "updatedAt",
      key: "updatedAt",
      width: 180,
      render: (v: string) => new Date(v).toLocaleString("zh-CN", { hour12: false }),
    },
    {
      title: "操作",
      key: "actions",
      width: 130,
      render: (_, n) => (
        <Space size={4}>
          <Button
            type="link"
            size="small"
            onClick={() => {
              setEditing(n);
              setDrawerOpen(true);
            }}
          >
            编辑
          </Button>
          <Popconfirm title="删除该笔记？" okText="删除" cancelText="取消" onConfirm={() => void remove(n)}>
            <Button type="link" size="small" danger>
              删除
            </Button>
          </Popconfirm>
        </Space>
      ),
    },
  ];

  return (
    <Card className="collection-card" title={<span className="collection-title">笔记列表<span className="collection-count">{items.length} 条</span></span>}>
      <Space className="collection-toolbar" wrap size={[10, 12]}>
        <Button
          type="primary"
          icon={<PlusOutlined />}
          onClick={() => {
            setEditing(null);
            setDrawerOpen(true);
          }}
        >
          新建笔记
        </Button>
        <Link to="/notes/graph"><Button icon={<ApartmentOutlined />}>知识图谱</Button></Link>
        <Button disabled={!items.length} loading={exportingZip} onClick={() => void exportZip()}>按当前筛选导出 ZIP（{items.length} 篇）</Button>
        <Input.Search aria-label="搜索笔记标题和内容" allowClear placeholder="搜索标题与内容" value={searchInput} onChange={event => setSearchInput(event.target.value)} style={{ width: 250 }} />
      </Space>
      <div className="notes-layout"><aside className="notes-sidebar" aria-label="笔记分类和标签">
        <div className="notes-sidebar-heading"><Typography.Text strong>分类</Typography.Text><Button size="small" type="text" icon={<SettingOutlined />} aria-label="管理分类" onClick={() => setCategoryManagerOpen(true)} /></div>
        <Button type={!categoryId ? "primary" : "text"} block className="notes-all-button" onClick={() => setCategoryId(null)}>全部笔记</Button>
        <Tree blockNode treeData={categoryTree} selectedKeys={categoryId ? [categoryId] : []} onSelect={keys => setCategoryId(keys.length ? String(keys[0]) : null)} />
        <div className="notes-sidebar-heading"><Typography.Text strong>标签云</Typography.Text>{isAdmin && <Button size="small" type="text" icon={<SettingOutlined />} aria-label="管理笔记标签" onClick={() => setTagManagerOpen(true)} />}</div>
        {tagCloud.length ? <div className="notes-tag-cloud">{tagCloud.map(tag => <button key={tag.name} type="button" className={selectedTags.includes(tag.name) ? "selected" : ""} style={{ fontSize: 12 + 12 * tag.count / maxTagCount }} onClick={() => setSelectedTags(current => current.includes(tag.name) ? current.filter(item => item !== tag.name) : [...current, tag.name])} title={`${tag.name} · ${tag.count} 篇`}>{tag.name}<sup>{tag.count}</sup></button>)}</div> : <Typography.Text type="secondary">暂无标签</Typography.Text>}
        {selectedTags.length > 0 && <Button type="link" size="small" onClick={() => setSelectedTags([])}>清除标签筛选</Button>}
      </aside><div className="notes-results"><Table
        rowKey="id"
        loading={loading}
        columns={columns}
        dataSource={items}
        scroll={{ x: 1050 }}
        pagination={{ pageSize: 8, showSizeChanger: false }}
        locale={{ emptyText: <div className="note-search-empty"><Typography.Text type="secondary">未找到，试试其他关键词</Typography.Text><Button type="primary" size="small" onClick={() => { setEditing(null); setDrawerOpen(true); }}>创建新笔记</Button></div> }}
      /></div></div>
      <NoteFormDrawer
        open={drawerOpen}
        initial={editing}
        tasks={tasks}
        categories={categories}
        onClose={() => setDrawerOpen(false)}
        onSaved={() => {
          setDrawerOpen(false);
          void load();
          void refreshTags();
        }}
      />
      <NoteCategoryManager open={categoryManagerOpen} categories={categories} onClose={() => setCategoryManagerOpen(false)} onChanged={() => void refreshCategories()} />
      {isAdmin && <NoteTagManager open={tagManagerOpen} tags={tagDefinitions} onClose={() => setTagManagerOpen(false)} onChanged={handleTagChanged} />}
    </Card>
  );
}
