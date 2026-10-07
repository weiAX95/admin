import { useEffect, useRef, useState } from "react";
import { App, Button, Rate, Select, Space, Tag, Typography } from "antd";
import { FileTextOutlined, LinkOutlined } from "@ant-design/icons";
import hljs from "highlight.js/lib/common";
import "highlight.js/styles/github-dark.css";
import type { MessageAnnotationTag, MessageAnnotationView, SessionMessage } from "../types";

const TAGS: MessageAnnotationTag[] = ["准确", "不准确", "偏题", "幻觉", "过于冗长", "过于简略", "格式错误"];

function renderMessage(content: string) {
  const fence = /```([^\n`]*)\n([\s\S]*?)```/g;
  const pieces: React.ReactNode[] = [];
  let offset = 0;
  for (const match of content.matchAll(fence)) {
    const index = match.index ?? 0;
    if (index > offset) pieces.push(<span key={`text-${offset}`}>{content.slice(offset, index)}</span>);
    const language = match[1].trim().split(/\s+/)[0].toLowerCase();
    let highlighted: string | null = null;
    try {
      if (!language) highlighted = hljs.highlightAuto(match[2]).value;
      else if (hljs.getLanguage(language)) highlighted = hljs.highlight(match[2], { language }).value;
    } catch { highlighted = null; }
    pieces.push(<pre key={`code-${index}`} className="session-code"><code className="hljs">{highlighted === null ? match[2] : <span dangerouslySetInnerHTML={{ __html: highlighted }} />}</code></pre>);
    offset = index + match[0].length;
  }
  if (offset < content.length) pieces.push(<span key={`text-${offset}`}>{content.slice(offset)}</span>);
  return pieces;
}

interface Props {
  entry: SessionMessage;
  onSave: (rating: number, tags: MessageAnnotationTag[]) => Promise<MessageAnnotationView>;
  onSinkNote: () => void;
  onLinkTask: () => void;
  onSaveSelection: (text: string) => void;
}

export default function SessionMessageBubble({ entry, onSave, onSinkNote, onLinkTask, onSaveSelection }: Props) {
  const { message } = App.useApp();
  const contentRef = useRef<HTMLDivElement>(null);
  const [selection, setSelection] = useState<{ text: string; left: number; top: number } | null>(null);
  useEffect(() => {
    const clearOutsideSelection = () => {
      const selected = window.getSelection();
      const content = contentRef.current;
      if (!selected || selected.isCollapsed || !content || !selected.anchorNode || !selected.focusNode || !content.contains(selected.anchorNode) || !content.contains(selected.focusNode)) setSelection(null);
    };
    document.addEventListener("selectionchange", clearOutsideSelection);
    return () => document.removeEventListener("selectionchange", clearOutsideSelection);
  }, []);
  const [expanded, setExpanded] = useState(false);
  const [rating, setRating] = useState(entry.annotation?.mine?.rating || 0);
  const [tags, setTags] = useState<MessageAnnotationTag[]>(entry.annotation?.mine?.tags || []);
  const [saved, setSaved] = useState(entry.annotation?.mine || null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    setRating(entry.annotation?.mine?.rating || 0);
    setTags(entry.annotation?.mine?.tags || []);
    setSaved(entry.annotation?.mine || null);
  }, [entry.id, entry.annotation?.mine]);
  const characters = Array.from(entry.content);
  const long = characters.length > 500;
  const save = async (nextRating: number, nextTags: MessageAnnotationTag[]) => {
    setRating(nextRating);
    setTags(nextTags);
    if (!nextRating || busy) return;
    setBusy(true);
    try {
      const result = await onSave(nextRating, nextTags);
      setSaved(result.mine);
    } catch (error) {
      setRating(saved?.rating || 0);
      setTags(saved?.tags || []);
      message.error(error instanceof Error ? error.message : "评分保存失败");
    } finally { setBusy(false); }
  };
  const summary = entry.annotation?.summary;
  const captureSelection = () => {
    const selected = window.getSelection();
    const content = contentRef.current;
    if (!selected || !content || selected.isCollapsed || !selected.anchorNode || !selected.focusNode || !content.contains(selected.anchorNode) || !content.contains(selected.focusNode)) { setSelection(null); return; }
    const text = selected.toString().trim();
    if (!text) { setSelection(null); return; }
    const rect = selected.getRangeAt(0).getBoundingClientRect();
    setSelection({ text, left: Math.max(8, Math.min(window.innerWidth - 150, rect.right)), top: Math.max(8, Math.min(window.innerHeight - 42, rect.bottom + 6)) });
  };
  return <div className={`session-bubble-row ${entry.role === "assistant" ? "session-bubble-row-assistant" : ""}`}>
    <div className={`session-message ${entry.role === "user" ? "session-message-user" : "session-message-assistant"}`}>
      <Space size={8} style={{ marginBottom: 6 }}><Tag color={entry.role === "user" ? "blue" : "purple"}>{entry.role === "user" ? "用户" : "Agent"}</Tag><Typography.Text type="secondary" style={{ fontSize: 11 }}>{new Date(entry.at).toLocaleString("zh-CN", { hour12: false })}</Typography.Text></Space>
      <div className="session-message-content" ref={contentRef} onMouseUp={captureSelection} onKeyUp={captureSelection} onTouchEnd={captureSelection}>{long && !expanded ? `${characters.slice(0, 500).join("")}…` : renderMessage(entry.content)}</div>
      {selection && <Button className="session-selection-action" type="primary" size="small" style={{ left: selection.left, top: selection.top }} onMouseDown={event => event.preventDefault()} onClick={() => { onSaveSelection(selection.text); setSelection(null); window.getSelection()?.removeAllRanges(); }}>保存为笔记</Button>}
      {long && <Button type="link" size="small" onClick={() => setExpanded(value => !value)}>{expanded ? "收起" : "展开全文"}</Button>}
      {entry.role === "assistant" && <>
        <div className="session-annotation">
          <Space wrap><Rate aria-label="为回答评分，1 到 5 星" allowClear={false} value={rating} disabled={busy} onChange={value => void save(value, tags)} /><Typography.Text type="secondary">{busy ? "保存中…" : summary?.ratingCount ? `平均 ${summary.averageRating?.toFixed(1)} 星 · ${summary.ratingCount} 人` : "暂无评分"}</Typography.Text></Space>
          <Select mode="multiple" aria-label="回答标签" placeholder="选择评价标签" style={{ width: "100%", marginTop: 8 }} disabled={busy} value={tags} options={TAGS.map(tag => ({ label: tag, value: tag }))} onChange={value => void save(rating, value)} />
          {!!summary?.tags.length && <div className="session-annotation-tags">{summary.tags.map(item => <Tag key={item.tag}>{item.tag} · {item.count}</Tag>)}</div>}
        </div>
        <Space size={8} style={{ marginTop: 10 }}><Button size="small" icon={<FileTextOutlined />} onClick={onSinkNote}>沉淀为笔记</Button><Button size="small" icon={<LinkOutlined />} onClick={onLinkTask}>关联任务</Button></Space>
      </>}
    </div>
  </div>;
}
