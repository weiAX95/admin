import { useDeferredValue, useRef, useState } from "react";
import { App, Button, Select, Space, Tooltip } from "antd";
import type { Note } from "../types";
import { uploadAsset } from "../api/assets";
import MarkdownContent from "./MarkdownContent";

type Props = { value?: string; onChange?: (value: string) => void; placeholder?: string; notes?: Pick<Note, "id" | "title">[]; rows?: number; enableWikiLinks?: boolean };
const actions = [
  { label: "粗体", before: "**", after: "**", sample: "加粗文字" },
  { label: "斜体", before: "*", after: "*", sample: "斜体文字" },
  { label: "标题", before: "\n## ", after: "\n", sample: "标题" },
  { label: "列表", before: "\n- ", after: "\n", sample: "列表项" },
  { label: "代码块", before: "\n```\n", after: "\n```\n", sample: "代码" },
  { label: "引用", before: "\n> ", after: "\n", sample: "引用内容" },
  { label: "链接", before: "[", after: "](https://)", sample: "链接文字" },
  { label: "表格", before: "\n| 列 1 | 列 2 |\n| --- | --- |\n| 内容 | 内容 |\n", after: "", sample: "" },
];

export default function MarkdownEditor({ value = "", onChange, placeholder, notes = [], rows = 12, enableWikiLinks = false }: Props) {
  const textarea = useRef<HTMLTextAreaElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const latestValue = useRef(value);
  latestValue.current = value;
  const deferred = useDeferredValue(value);
  const [uploading, setUploading] = useState(false);
  const { message } = App.useApp();
  const insert = (before: string, after = "", sample = "") => {
    const area = textarea.current;
    const current = latestValue.current;
    const start = area?.selectionStart ?? current.length;
    const end = area?.selectionEnd ?? start;
    const selection = current.slice(start, end) || sample;
    onChange?.(current.slice(0, start) + before + selection + after + current.slice(end));
    requestAnimationFrame(() => {
      area?.focus();
      area?.setSelectionRange(start + before.length, start + before.length + selection.length);
    });
  };
  const upload = async (file: File) => {
    if (!file.type.startsWith("image/")) return;
    if (file.size > 10 * 1024 * 1024) { message.error("图片不能超过 10 MB"); return; }
    const start = textarea.current?.selectionStart ?? latestValue.current.length;
    const end = textarea.current?.selectionEnd ?? start;
    setUploading(true);
    try {
      const result = await uploadAsset(file);
      const current = latestValue.current;
      onChange?.(`${current.slice(0, start)}![图片](${result.url})${current.slice(end)}`);
      message.success("图片已插入");
    } catch (error) {
      message.error(error instanceof Error ? error.message : "图片上传失败");
    } finally { setUploading(false); }
  };
  return <div className="markdown-editor">
    <div className="markdown-toolbar" role="toolbar" aria-label="Markdown 格式工具栏">
      <Space wrap size={4}>
        {actions.map(action => <Tooltip title={action.label} key={action.label}><Button size="small" type="text" onClick={() => insert(action.before, action.after, action.sample)}>{action.label}</Button></Tooltip>)}
        <Button size="small" type="text" loading={uploading} onClick={() => fileInput.current?.click()}>图片</Button>
        <input ref={fileInput} type="file" accept="image/png,image/jpeg,image/webp,image/gif" hidden onChange={event => { const file = event.target.files?.[0]; if (file) void upload(file); event.target.value = ""; }} />
        {enableWikiLinks && notes.length > 0 && <Select size="small" showSearch placeholder="插入笔记引用" style={{ minWidth: 150 }} value={undefined} optionFilterProp="label" options={notes.map(note => ({ value: note.id, label: note.title }))} onChange={id => { const note = notes.find(item => item.id === id); if (note) insert(`[[${note.title}|id:${note.id}]]`); }} />}
      </Space>
    </div>
    <div className="markdown-editor-panes">
      <div className="markdown-editor-pane"><div className="markdown-pane-label">编辑</div><textarea ref={textarea} value={value} onChange={event => onChange?.(event.target.value)} onPaste={event => {
        const file = [...event.clipboardData.files].find(item => item.type.startsWith("image/"));
        if (file) { event.preventDefault(); void upload(file); }
      }} placeholder={placeholder} rows={rows} aria-label="Markdown 内容编辑" /></div>
      <div className="markdown-preview-pane"><div className="markdown-pane-label">实时预览</div><MarkdownContent content={deferred} notes={notes} enableWikiLinks={enableWikiLinks} /></div>
    </div>
  </div>;
}
