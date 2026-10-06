import type { LearningTask } from "../types";

const LABELS = { todo: "待办", in_progress: "进行中", done: "已完成", blocked: "受阻" };
const COLORS = ["#9582ff", "#65c8a4", "#f3ba68", "#ee8394", "#6db8e9", "#b1a5ce"];
const shanghaiDate = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : new Date(value).toLocaleDateString("en-CA", { timeZone: "Asia/Shanghai" });

async function chartImage(type: "pie" | "bar", labels: string[], counts: number[]) {
  const { default: Chart } = await import("chart.js/auto");
  const canvas = document.createElement("canvas");
  canvas.width = 850; canvas.height = 430;
  const chart = new Chart(canvas, {
    type,
    data: { labels, datasets: [{ label: "任务数", data: counts, backgroundColor: labels.map((_, index) => COLORS[index % COLORS.length]), borderWidth: 0 }] },
    options: { responsive: false, animation: false, plugins: { legend: { display: type === "pie", position: "right", labels: { color: "#222633", font: { size: 17 } } }, title: { display: false } }, scales: type === "bar" ? { x: { ticks: { color: "#222633", font: { size: 17 } } }, y: { beginAtZero: true, ticks: { precision: 0, color: "#222633", font: { size: 16 } } } } : {} },
  });
  chart.update("none");
  const png = chart.toBase64Image("image/png");
  chart.destroy();
  return png;
}

export async function makeTaskPdf(tasks: LearningTask[]): Promise<{ blob: Blob; durationMs: number }> {
  const started = performance.now();
  const [{ PDFDocument, rgb }, { default: fontkit }, fontResponse] = await Promise.all([import("pdf-lib"), import("@pdf-lib/fontkit"), fetch("/fonts/NotoSansCJKsc-Regular.otf")]);
  if (!fontResponse.ok) throw new Error("中文字体加载失败");
  const pdf = await PDFDocument.create();
  pdf.registerFontkit(fontkit);
  const font = await pdf.embedFont(await fontResponse.arrayBuffer());
  pdf.setTitle("学习任务报告");
  const dark = rgb(0.12, 0.14, 0.21);
  const muted = rgb(0.36, 0.39, 0.47);
  const purple = rgb(0.58, 0.51, 1);
  const pageSize: [number, number] = [842, 595];
  const margin = 40;
  const statuses = ["todo", "in_progress", "done", "blocked"] as const;
  const statusCounts = statuses.map(status => tasks.filter(task => task.effectiveStatus === status).length);
  const categories = new Map<string, number>();
  for (const task of tasks) categories.set(task.category || "未分类", (categories.get(task.category || "未分类") || 0) + 1);
  const categoryEntries = [...categories].sort((a, b) => b[1] - a[1]);
  const today = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Shanghai" });
  const overdue = tasks.filter(task => task.effectiveStatus !== "done" && task.dueDate && shanghaiDate(task.dueDate) < today).length;
  const average = tasks.length ? Math.round(tasks.reduce((sum, task) => sum + task.progress, 0) / tasks.length) : 0;
  const page = pdf.addPage(pageSize);
  page.drawText("学习任务报告", { x: margin, y: 530, font, size: 23, color: dark });
  page.drawText(`生成时间：${new Date().toLocaleString("zh-CN", { timeZone: "Asia/Shanghai", hour12: false })} · 当前筛选结果`, { x: margin, y: 502, font, size: 10, color: muted });
  page.drawText(`任务总数 ${tasks.length}    平均进度 ${average}%    逾期 ${overdue}    已完成 ${statusCounts[2]}`, { x: margin, y: 464, font, size: 13, color: purple });
  page.drawText(`待办 ${statusCounts[0]}    进行中 ${statusCounts[1]}    受阻 ${statusCounts[3]}`, { x: margin, y: 440, font, size: 11, color: dark });
  page.drawText("分类分布", { x: margin, y: 405, font, size: 13, color: dark });
  page.drawText("状态分布", { x: 440, y: 405, font, size: 13, color: dark });
  if (tasks.length) {
    const [pie, bar] = await Promise.all([
      chartImage("pie", categoryEntries.map(([label]) => label), categoryEntries.map(([, count]) => count)),
      chartImage("bar", statuses.map(status => LABELS[status]), statusCounts),
    ]);
    page.drawImage(await pdf.embedPng(pie), { x: margin, y: 170, width: 365, height: 210 });
    page.drawImage(await pdf.embedPng(bar), { x: 440, y: 170, width: 360, height: 210 });
  } else page.drawText("当前筛选条件下暂无任务", { x: margin, y: 320, font, size: 13, color: muted });
  page.drawText("任务列表见后续页面", { x: margin, y: 82, font, size: 11, color: muted });

  const columns = [
    { label: "标题", width: 240, value: (task: LearningTask) => task.title },
    { label: "分类", width: 105, value: (task: LearningTask) => task.category },
    { label: "阶段", width: 80, value: (task: LearningTask) => task.phase },
    { label: "状态", width: 75, value: (task: LearningTask) => LABELS[task.effectiveStatus] },
    { label: "优先级", width: 70, value: (task: LearningTask) => ({ high: "高", medium: "中", low: "低" })[task.priority] },
    { label: "进度", width: 70, value: (task: LearningTask) => `${task.progress}%` },
    { label: "到期", width: 90, value: (task: LearningTask) => task.dueDate ? shanghaiDate(task.dueDate) : "—" },
  ];
  const fit = (value: string, width: number, size: number) => {
    let result = value;
    while (result && font.widthOfTextAtSize(result, size) > width - 8) result = result.slice(0, -1);
    return result === value ? result : `${result.slice(0, -1)}…`;
  };
  for (let offset = 0; offset < tasks.length; offset += 20) {
    const sheet = pdf.addPage(pageSize);
    sheet.drawText(`任务列表 · ${Math.floor(offset / 20) + 1}`, { x: margin, y: 540, font, size: 17, color: dark });
    let x = margin;
    for (const column of columns) { sheet.drawText(column.label, { x, y: 507, font, size: 10, color: purple }); x += column.width; }
    tasks.slice(offset, offset + 20).forEach((task, index) => {
      const y = 485 - index * 22;
      if (index % 2 === 0) sheet.drawRectangle({ x: margin - 3, y: y - 5, width: 760, height: 21, color: rgb(0.96, 0.96, 0.99) });
      let columnX = margin;
      for (const column of columns) { sheet.drawText(fit(String(column.value(task) || ""), column.width, 9), { x: columnX, y, font, size: 9, color: dark }); columnX += column.width; }
    });
  }
  const bytes = await pdf.save();
  return { blob: new Blob([new Uint8Array(bytes)], { type: "application/pdf" }), durationMs: Math.round(performance.now() - started) };
}
