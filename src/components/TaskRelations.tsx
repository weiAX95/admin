import { useEffect, useState } from "react";
import { Alert, Button, Card, Empty, Space, Spin, Tabs, Typography } from "antd";
import { Link } from "react-router-dom";
import { listNotes } from "../api/notes";
import { markdownSummary } from "../utils/markdown-summary";
import { listExperiments } from "../api/experiments";
import { NoteFormDrawer } from "../pages/Notes";
import { ExperimentFormDrawer } from "../pages/Experiments";
import type { Experiment, LearningTask, Note } from "../types";

export default function TaskRelations({ task }: { task: LearningTask }) {
  const [notes, setNotes] = useState<Note[]>([]);
  const [experiments, setExperiments] = useState<Experiment[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [noteOpen, setNoteOpen] = useState(false);
  const [experimentOpen, setExperimentOpen] = useState(false);
  const [reload, setReload] = useState(0);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError("");
    Promise.all([listNotes(task.id), listExperiments(task.id)])
      .then(([noteResult, experimentResult]) => {
        if (alive) { setNotes(noteResult.items); setExperiments(experimentResult.items); }
      })
      .catch(cause => { if (alive) setError(cause instanceof Error ? cause.message : "加载关联内容失败"); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [task.id, reload]);

  return <Card title="关联笔记与实验" className="task-relations">
    {error && <Alert type="error" showIcon message={error} action={<Button size="small" onClick={() => setReload(value => value + 1)}>重试</Button>} />}
    <Tabs items={[
      { key: "notes", label: `笔记（${notes.length}）`, children: <>
        <Button type="primary" onClick={() => setNoteOpen(true)}>快速创建笔记</Button>
        {loading ? <Spin className="task-detail-loading" /> : notes.length === 0 ? <Empty description="暂无关联" /> : <div className="task-relation-grid">{notes.map(note => <Link to={`/notes/${note.id}`} key={note.id} className="task-relation-link"><Card size="small" hoverable title={note.title}><Typography.Paragraph ellipsis={{ rows: 3 }}>{markdownSummary(note.content) || "暂无内容"}</Typography.Paragraph><Typography.Text type="secondary">{new Date(note.updatedAt).toLocaleString("zh-CN", { hour12: false })}</Typography.Text></Card></Link>)}</div>}
      </> },
      { key: "experiments", label: `实验（${experiments.length}）`, children: <>
        <Button type="primary" onClick={() => setExperimentOpen(true)}>快速创建实验</Button>
        {loading ? <Spin className="task-detail-loading" /> : experiments.length === 0 ? <Empty description="暂无关联实验" /> : <div className="task-relation-grid">{experiments.map(experiment => <Link to={`/experiments/${experiment.id}`} key={experiment.id} className="task-relation-link"><Card size="small" hoverable title={experiment.title}><Typography.Paragraph ellipsis={{ rows: 3 }}>{markdownSummary(experiment.result) || "暂无结果观察"}</Typography.Paragraph><Space><Typography.Text type="secondary">{experiment.model || "未填写模型"}</Typography.Text><Typography.Text type="secondary">自评 {experiment.score}/5</Typography.Text></Space></Card></Link>)}</div>}
      </> },
    ]} />
    <NoteFormDrawer open={noteOpen} initial={null} tasks={[task]} defaultTaskId={task.id} onClose={() => setNoteOpen(false)} onSaved={() => { setNoteOpen(false); setReload(value => value + 1); }} />
    <ExperimentFormDrawer open={experimentOpen} initial={null} tasks={[task]} defaultTaskId={task.id} onClose={() => setExperimentOpen(false)} onSaved={() => { setExperimentOpen(false); setReload(value => value + 1); }} />
  </Card>;
}
