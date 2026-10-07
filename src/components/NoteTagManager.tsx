import { useState } from "react";
import { App, Button, Input, Modal, Popconfirm, Select, Space, Typography } from "antd";
import { createNoteTag, deleteNoteTag, mergeNoteTag, renameNoteTag } from "../api/notes";
import type { NoteTagDefinition } from "../types";

export type NoteTagChange = { from?: string; to?: string };

export default function NoteTagManager({ open, tags, onClose, onChanged }: { open: boolean; tags: NoteTagDefinition[]; onClose: () => void; onChanged: (change: NoteTagChange) => void }) {
  const { message } = App.useApp();
  const [editing, setEditing] = useState<NoteTagDefinition | null>(null);
  const [name, setName] = useState("");
  const [mergeSource, setMergeSource] = useState<NoteTagDefinition | null>(null);
  const [targetId, setTargetId] = useState<string>();
  const [busy, setBusy] = useState(false);
  const resetEdit = () => { setEditing(null); setName(""); };
  const save = async () => {
    setBusy(true);
    try {
      if (editing) {
        const result = await renameNoteTag(editing.id, name);
        message.success("标签已重命名");
        onChanged({ from: editing.name, to: result.name });
      } else {
        await createNoteTag(name);
        message.success("标签已创建");
        onChanged({});
      }
      resetEdit();
    } catch (error) { message.error(error instanceof Error ? error.message : "保存标签失败"); }
    finally { setBusy(false); }
  };
  const remove = async (tag: NoteTagDefinition) => {
    setBusy(true);
    try {
      await deleteNoteTag(tag.id, tag.count);
      message.success("标签已删除");
      if (editing?.id === tag.id) resetEdit();
      onChanged({ from: tag.name });
    } catch (error) { message.error(error instanceof Error ? error.message : "删除标签失败"); onChanged({}); }
    finally { setBusy(false); }
  };
  const merge = async () => {
    if (!mergeSource || !targetId) return;
    setBusy(true);
    try {
      const result = await mergeNoteTag(mergeSource.id, targetId, mergeSource.count);
      message.success(`已合并 ${result.affectedCount} 篇笔记中的标签`);
      onChanged({ from: mergeSource.name, to: result.target.name });
      setMergeSource(null); setTargetId(undefined);
    } catch (error) { message.error(error instanceof Error ? error.message : "合并标签失败"); onChanged({}); }
    finally { setBusy(false); }
  };
  return <Modal title="管理笔记标签" open={open} onCancel={() => { resetEdit(); onClose(); }} footer={null} width={620}>
    <div className="note-category-form">
      <Typography.Text strong>{editing ? `重命名 ${editing.name}（影响 ${editing.count} 篇）` : "创建标签"}</Typography.Text>
      <Space.Compact block><Input aria-label="标签名称" maxLength={32} placeholder="输入标签名称" value={name} onChange={event => setName(event.target.value)} onPressEnter={() => void save()} /><Button type="primary" loading={busy} disabled={!name.trim()} onClick={() => void save()}>{editing ? "保存名称" : "创建"}</Button></Space.Compact>
      {editing && <Button size="small" onClick={resetEdit}>取消重命名</Button>}
    </div>
    <div className="note-category-list">
      {tags.length ? tags.map(tag => <div key={tag.id} className="note-category-row">
        <Space><Typography.Text>{tag.name}</Typography.Text><Typography.Text type="secondary">{tag.count} 篇</Typography.Text></Space>
        <Space size={4}><Button size="small" type="link" disabled={busy} onClick={() => { setEditing(tag); setName(tag.name); }}>重命名</Button><Button size="small" type="link" disabled={busy || tags.length < 2} onClick={() => { setMergeSource(tag); setTargetId(undefined); }}>合并</Button><Popconfirm title={`确定删除标签「${tag.name}」？`} description={`将从 ${tag.count} 篇笔记中移除。`} okText="删除" okButtonProps={{ danger: true, loading: busy }} cancelText="取消" onConfirm={() => void remove(tag)}><Button size="small" type="link" disabled={busy} danger>删除</Button></Popconfirm></Space>
      </div>) : <Typography.Text type="secondary">暂无标签，可在这里创建，或在编辑笔记时输入。</Typography.Text>}
    </div>
    <Modal title="合并笔记标签" open={Boolean(mergeSource)} okText="确认合并" okButtonProps={{ disabled: !targetId, loading: busy }} onOk={() => void merge()} onCancel={() => { setMergeSource(null); setTargetId(undefined); }}>
      <Space direction="vertical" style={{ width: "100%" }}><Typography.Text>将「{mergeSource?.name}」合并到目标标签，影响 {mergeSource?.count ?? 0} 篇笔记；同一笔记中的重复标签会合并。</Typography.Text><Select aria-label="合并目标标签" placeholder="选择目标标签" style={{ width: "100%" }} value={targetId} options={tags.filter(tag => tag.id !== mergeSource?.id).map(tag => ({ value: tag.id, label: `${tag.name}（${tag.count} 篇）` }))} onChange={setTargetId} /></Space>
    </Modal>
  </Modal>;
}
