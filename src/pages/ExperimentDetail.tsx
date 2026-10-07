import { useEffect, useState } from "react";
import { Alert, Card, Descriptions, Spin } from "antd";
import { Link, useParams } from "react-router-dom";
import { getExperiment } from "../api/experiments";
import type { Experiment } from "../types";
import MarkdownContent from "../components/MarkdownContent";

export default function ExperimentDetail() {
  const { id } = useParams();
  const [experiment, setExperiment] = useState<Experiment | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    let alive = true;
    getExperiment(id || "").then(value => { if (alive) setExperiment(value); })
      .catch(cause => { if (alive) setError(cause instanceof Error ? cause.message : "加载实验失败"); });
    return () => { alive = false; };
  }, [id]);
  if (error) return <Alert type="error" showIcon message={error} />;
  if (!experiment) return <Spin className="task-detail-loading" />;
  return <Card title={experiment.title} extra={experiment.taskId ? <Link to={`/tasks/${experiment.taskId}`}>返回关联任务</Link> : <Link to="/experiments">返回实验列表</Link>}>
    <Descriptions column={{ xs: 1, md: 2 }} items={[
      { key: "model", label: "模型", children: experiment.model || "未填写" },
      { key: "score", label: "自评", children: `${experiment.score} / 5` },
      { key: "time", label: "创建时间", children: new Date(experiment.createdAt).toLocaleString("zh-CN", { hour12: false }) },
      { key: "params", label: "参数", children: experiment.params || "未填写" },
    ]} />
    <div className="task-detail-section"><h4>Prompt</h4><MarkdownContent content={experiment.prompt || "暂无内容"} /></div>
    <div className="task-detail-section"><h4>结果观察</h4><MarkdownContent content={experiment.result || "暂无结果观察"} /></div>
  </Card>;
}
