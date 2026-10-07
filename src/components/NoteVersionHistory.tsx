import { useEffect, useMemo, useState } from "react";
import { App, Button, Empty, Popconfirm, Select, Space, Spin, Typography } from "antd";
import { diffLines } from "diff";
import { listNoteVersions, restoreNoteVersion } from "../api/notes";
import type { NoteVersion } from "../types";
import MarkdownContent from "./MarkdownContent";

export default function NoteVersionHistory({ noteId, onRestored }: { noteId: string; onRestored: () => void }) {
  const { message } = App.useApp();
  const [items, setItems] = useState<NoteVersion[]>([]);
  const [selectedId, setSelectedId] = useState<string>();
  const [leftId, setLeftId] = useState<string>();
  const [rightId, setRightId] = useState<string>();
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const refresh = async (selectNewest = false) => {
    setLoading(true);
    try {
      const versions = (await listNoteVersions(noteId)).items;
      setItems(versions);
      setSelectedId(previous => !selectNewest && previous && versions.some(item => item.id === previous) ? previous : versions[0]?.id);
      setLeftId(previous => previous && versions.some(item => item.id === previous) ? previous : versions[1]?.id);
      setRightId(previous => previous && versions.some(item => item.id === previous) ? previous : versions[0]?.id);
    } catch (error) { message.error(error instanceof Error ? error.message : "加载历史版本失败"); }
    finally { setLoading(false); }
  };
  useEffect(() => { void refresh(); }, [noteId]);
  const selected = items.find(item => item.id === selectedId);
  const left = items.find(item => item.id === leftId);
  const right = items.find(item => item.id === rightId);
  const changes = useMemo(() => left && right ? diffLines(left.content, right.content) : [], [left, right]);
  const restore = async (version: NoteVersion) => {
    setBusy(true);
    try {
      await restoreNoteVersion(noteId, version.id);
      message.success(`已恢复版本 ${version.versionNumber}，并生成新版本`);
      await refresh(true); onRestored();
    } catch (error) { message.error(error instanceof Error ? error.message : "恢复版本失败"); }
    finally { setBusy(false); }
  };
  if (loading && !items.length) return <Spin />;
  if (!items.length) return <Empty description="暂无历史版本" />;
  const options = items.map(item => ({ value: item.id, label: `版本 ${item.versionNumber} · ${new Date(item.createdAt).toLocaleString("zh-CN", { hour12: false })}` }));
  return <div className="note-version-layout">
    <div className="note-version-list"><Typography.Title level={5}>版本时间线</Typography.Title>{items.map(item => <div key={item.id} className={`note-version-row${item.id === selectedId ? " selected" : ""}`}><Button type="link" onClick={() => setSelectedId(item.id)}>版本 {item.versionNumber} · {new Date(item.createdAt).toLocaleString("zh-CN", { hour12: false })}</Button><Typography.Text type="secondary">{item.reason === "restore" ? "回滚生成" : item.reason === "baseline" ? "历史基线" : "保存"}</Typography.Text></div>)}</div>
    <div className="note-version-main">
      {selected && <><Space wrap><Typography.Title level={5} style={{ margin: 0 }}>查看版本 {selected.versionNumber}</Typography.Title><Popconfirm title={`恢复到版本 ${selected.versionNumber}？`} description="恢复后会生成一条新版本，旧版本仍保留。" okText="恢复" cancelText="取消" onConfirm={() => void restore(selected)}><Button size="small" loading={busy}>回滚到此版本</Button></Popconfirm></Space><Typography.Title level={4}>{selected.title}</Typography.Title><MarkdownContent content={selected.content} /></>}
      {items.length > 1 && <div className="note-version-compare"><Typography.Title level={5}>对比两个版本</Typography.Title><Space wrap><Select aria-label="对比旧版本" value={leftId} options={options} onChange={setLeftId} style={{ width: 245 }} /><Typography.Text>→</Typography.Text><Select aria-label="对比新版本" value={rightId} options={options} onChange={setRightId} style={{ width: 245 }} /></Space>
        {left && right && <div className="note-diff-grid"><div><Typography.Text strong>旧：</Typography.Text><div className={left.title !== right.title ? "note-diff-removed" : ""}>{left.title}</div>{changes.map((change, index) => !change.added && <pre key={index} className={change.removed ? "note-diff-removed" : ""}>{change.value}</pre>)}</div><div><Typography.Text strong>新：</Typography.Text><div className={left.title !== right.title ? "note-diff-added" : ""}>{right.title}</div>{changes.map((change, index) => !change.removed && <pre key={index} className={change.added ? "note-diff-added" : ""}>{change.value}</pre>)}</div></div>}
      </div>}
    </div>
  </div>;
}
