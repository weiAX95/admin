import { useState } from "react";
import { App, Button, Input, Modal, Popconfirm, Select, Space, Typography } from "antd";
import { createNoteCategory, deleteNoteCategory, updateNoteCategory } from "../api/notes";
import type { NoteCategory } from "../types";

export function categoryPath(id: string | null | undefined, categories: NoteCategory[]): string {
  if (!id) return "未分类";
  const pieces: string[] = [];
  const visited = new Set<string>();
  let current = categories.find(item => item.id === id);
  while (current && !visited.has(current.id)) {
    visited.add(current.id);
    pieces.unshift(current.name);
    current = categories.find(item => item.id === current?.parentId);
  }
  return pieces.join(" / ") || "未分类";
}

export default function NoteCategoryManager({ open, categories, onClose, onChanged }: { open: boolean; categories: NoteCategory[]; onClose: () => void; onChanged: () => void }) {
  const { message } = App.useApp();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [parentId, setParentId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const reset = () => { setEditingId(null); setName(""); setParentId(null); };
  const save = async () => {
    setBusy(true);
    try {
      if (editingId) await updateNoteCategory(editingId, { name, parentId });
      else await createNoteCategory(name, parentId);
      message.success(editingId ? "分类已更新" : "分类已创建");
      reset(); onChanged();
    } catch (error) { message.error(error instanceof Error ? error.message : "保存分类失败"); }
    finally { setBusy(false); }
  };
  const remove = async (id: string) => {
    try { await deleteNoteCategory(id); message.success("分类已删除"); if (editingId === id) reset(); onChanged(); }
    catch (error) { message.error(error instanceof Error ? error.message : "删除分类失败"); }
  };
  const options = categories.filter(item => item.id !== editingId).map(item => ({ value: item.id, label: categoryPath(item.id, categories) }));
  const renderBranch = (parent: string | null, depth = 0): React.ReactNode => categories.filter(item => (item.parentId || null) === parent).map(item => <div key={item.id} className="note-category-row" style={{ paddingLeft: depth * 16 }}>
    <span>{item.name}</span><Space size={4}><Button size="small" type="link" onClick={() => { setEditingId(item.id); setName(item.name); setParentId(item.parentId); }}>编辑</Button><Popconfirm title="删除这个分类？" description="分类下的笔记将变为未分类；有子分类时请先处理子分类。" onConfirm={() => void remove(item.id)}><Button size="small" danger type="link">删除</Button></Popconfirm></Space>
    {renderBranch(item.id, depth + 1)}
  </div>);
  return <Modal title="管理笔记分类" open={open} onCancel={() => { reset(); onClose(); }} footer={null} width={560}>
    <div className="note-category-form"><Typography.Text strong>{editingId ? "编辑分类" : "新建分类"}</Typography.Text><Space.Compact block><Input aria-label="分类名称" maxLength={60} placeholder="分类名称" value={name} onChange={event => setName(event.target.value)} /><Select aria-label="上级分类" allowClear placeholder="顶级分类" style={{ minWidth: 170 }} value={parentId || undefined} options={options} onChange={value => setParentId(value || null)} /></Space.Compact><Space><Button type="primary" loading={busy} disabled={!name.trim()} onClick={() => void save()}>{editingId ? "保存修改" : "创建分类"}</Button>{editingId && <Button onClick={reset}>取消编辑</Button>}</Space></div>
    <div className="note-category-list">{categories.length ? renderBranch(null) : <Typography.Text type="secondary">暂无分类</Typography.Text>}</div>
  </Modal>;
}
