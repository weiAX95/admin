import { useEffect, useState } from "react";
import { Alert, App, Button, Card, Descriptions, Dropdown, Empty, Progress, Space, Spin, Tabs, Tag, Typography } from "antd";
import { Link, useParams } from "react-router-dom";
import { getNote, listNoteCategories, listNotes } from "../api/notes";
import { getTask } from "../api/tasks";
import type { LearningTask, Note, NoteCategory, NoteDetailData } from "../types";
import MarkdownContent from "../components/MarkdownContent";
import { categoryPath } from "../components/NoteCategoryManager";
import { StatusTag } from "../components/TaskMeta";
import NoteVersionHistory from "../components/NoteVersionHistory";
import { downloadBlob, noteFilename, noteHtml, noteMarkdown } from "../utils/noteExport";

export default function NoteDetail() {
  const { message } = App.useApp();
  const { id } = useParams();
  const [note, setNote] = useState<NoteDetailData | null>(null);
  const [notes, setNotes] = useState<Note[]>([]);
  const [categories, setCategories] = useState<NoteCategory[]>([]);
  const [linkedTask, setLinkedTask] = useState<LearningTask | null>(null);
  const [taskLoading, setTaskLoading] = useState(false);
  const [error, setError] = useState("");
  const [exporting, setExporting] = useState(false);
  useEffect(() => {
    let alive = true;
    getNote(id || "").then(value => { if (alive) setNote(value); })
      .catch(cause => { if (alive) setError(cause instanceof Error ? cause.message : "加载笔记失败"); });
    listNotes().then(value => { if (alive) setNotes(value.items); }).catch(() => undefined);
    listNoteCategories().then(value => { if (alive) setCategories(value.items); }).catch(() => undefined);
    return () => { alive = false; };
  }, [id]);
  useEffect(() => {
    if (!note?.taskId) { setLinkedTask(null); setTaskLoading(false); return; }
    let alive = true;
    setTaskLoading(true);
    getTask(encodeURIComponent(note.taskId)).then(value => { if (alive) setLinkedTask(value); }).catch(() => { if (alive) setLinkedTask(null); }).finally(() => { if (alive) setTaskLoading(false); });
    return () => { alive = false; };
  }, [note?.taskId]);
  if (error) return <Alert type="error" showIcon message={error} />;
  if (!note) return <Spin className="task-detail-loading" />;
  const exportNote = async (format: "md" | "html" | "pdf") => {
    setExporting(true);
    try {
      const name = noteFilename(note).slice(0, -3);
      if (format === "md") downloadBlob(new Blob([noteMarkdown(note)], { type: "text/markdown;charset=utf-8" }), `${name}.md`);
      else if (format === "html") downloadBlob(new Blob([await noteHtml(note)], { type: "text/html;charset=utf-8" }), `${name}.html`);
      else { const { makeNotePdf } = await import("../utils/notePdf"); downloadBlob(await makeNotePdf(note), `${name}.pdf`); }
      message.success("笔记已导出");
    } catch (cause) { message.error(cause instanceof Error ? cause.message : "导出笔记失败"); }
    finally { setExporting(false); }
  };
  const content = <>
    <Descriptions column={1} items={[
      { key: "updated", label: "更新时间", children: new Date(note.updatedAt).toLocaleString("zh-CN", { hour12: false }) },
      { key: "source", label: "来源", children: note.sourceSessionMissing ? <Typography.Text type="secondary">原会话已清理</Typography.Text> : note.sourceSessionId ? "会话沉淀" : "手动创建" },
      { key: "category", label: "分类", children: categoryPath(note.categoryId, categories) },
      { key: "tags", label: "标签", children: note.tags?.length ? note.tags.map(tag => <Tag key={tag}>{tag}</Tag>) : "无标签" },
    ]} />
    <div className="note-linked-task"><Typography.Title level={5}>关联任务</Typography.Title>{taskLoading ? <Spin size="small" /> : linkedTask ? <Link to={`/tasks/${linkedTask.id}`}><Card hoverable size="small" title={linkedTask.title}><Space wrap><StatusTag status={linkedTask.effectiveStatus || linkedTask.status} /><Typography.Text type="secondary">进度 {linkedTask.progress}%</Typography.Text></Space><Progress percent={linkedTask.progress} size="small" showInfo={false} /></Card></Link> : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无关联" />}</div>
    <MarkdownContent content={note.content} notes={notes} enableWikiLinks />
    <div className="note-references"><div><Typography.Title level={5}>引用了以下笔记</Typography.Title>{note.links.length ? <Space direction="vertical">{note.links.map(link => link.targetId ? <Link key={link.order} to={`/notes/${link.targetId}`}>{link.targetTitle || link.label}</Link> : <span className="wiki-link-missing" title="笔记不存在" key={link.order}>{link.label}</span>)}</Space> : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无引用" />}</div><div><Typography.Title level={5}>被以下笔记引用</Typography.Title>{note.backlinks.length ? <Space direction="vertical">{note.backlinks.map(link => <Link key={link.id} to={`/notes/${link.id}`}>{link.title}</Link>)}</Space> : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无反向引用" />}</div></div>
    <Space><Link to="/notes/graph"><Button>查看知识图谱</Button></Link><Link to="/notes"><Button>查看全部笔记</Button></Link></Space>
  </>;
  return <Card title={note.title} extra={<Space><Dropdown menu={{ items: ["md", "pdf", "html"].map(format => ({ key: format, label: format === "md" ? "导出 Markdown" : format === "pdf" ? "导出 PDF" : "导出 HTML" })), onClick: ({ key }) => void exportNote(key as "md" | "pdf" | "html") }}><Button loading={exporting}>导出笔记</Button></Dropdown>{note.taskId ? <Link to={`/tasks/${note.taskId}`}>返回关联任务</Link> : <Link to="/notes">返回笔记列表</Link>}</Space>}>
    <Tabs items={[{ key: "content", label: "正文", children: content }, { key: "history", label: "历史版本", children: <NoteVersionHistory noteId={note.id} onRestored={() => { void getNote(note.id).then(setNote); }} /> }]} />
  </Card>;
}
