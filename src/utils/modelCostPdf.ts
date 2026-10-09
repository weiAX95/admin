import type { ModelCostsReport } from '../api/model-costs';

export async function makeModelCostPdf(report: ModelCostsReport, fontBytes?: ArrayBuffer | Uint8Array): Promise<Blob> {
  const [{ PDFDocument, rgb }, { default: fontkit }] = await Promise.all([import('pdf-lib'), import('@pdf-lib/fontkit')]);
  const bytes = fontBytes ?? await fetch('/fonts/NotoSansCJKsc-Regular.otf').then(response => { if (!response.ok) throw new Error('中文字体加载失败'); return response.arrayBuffer(); });
  if (!bytes) throw new Error('中文字体加载失败');
  const pdf = await PDFDocument.create();
  pdf.registerFontkit(fontkit);
  const font = await pdf.embedFont(bytes);
  pdf.setTitle('模型成本报告');
  const size: [number, number] = [842, 595];
  const dark = rgb(.12, .14, .21), muted = rgb(.37, .40, .48), purple = rgb(.58, .51, 1);
  const draw = (page: ReturnType<typeof pdf.addPage>, value: string, x: number, y: number, fontSize = 10, color = dark) => page.drawText(value, { x, y, size: fontSize, font, color });
  const fit = (value: string, width: number, fontSize = 9) => { let text = value; while (text && font.widthOfTextAtSize(text, fontSize) > width - 8) text = text.slice(0, -1); return text === value ? text : `${text.slice(0, -1)}…`; };
  const page = pdf.addPage(size);
  draw(page, '模型成本报告', 40, 540, 22);
  draw(page, `${report.start} 至 ${report.end} · UTC 日期 · ${report.dimension === 'model' ? '按模型' : report.dimension === 'user' ? '按账号' : '按模块'}`, 40, 510, 10, muted);
  draw(page, `总成本 $${report.totalUsd}    项目数 ${report.breakdown.length}`, 40, 475, 15, purple);
  draw(page, '每日成本趋势', 40, 430, 13);
  const left = 65, bottom = 195, width = 715, height = 205;
  page.drawLine({ start: { x: left, y: bottom }, end: { x: left + width, y: bottom }, thickness: 1, color: muted });
  page.drawLine({ start: { x: left, y: bottom }, end: { x: left, y: bottom + height }, thickness: 1, color: muted });
  const values = report.trend.map(item => Number(item.costUsd));
  const maximum = Math.max(0, ...values);
  if (values.length) {
    for (let index = 0; index < values.length; index++) {
      const x = left + index / Math.max(1, values.length - 1) * width;
      const y = bottom + (maximum ? values[index] / maximum : 0) * height;
      page.drawCircle({ x, y, size: 2, color: purple });
      if (index) {
        const previous = { x: left + (index - 1) / Math.max(1, values.length - 1) * width, y: bottom + (maximum ? values[index - 1] / maximum : 0) * height };
        page.drawLine({ start: previous, end: { x, y }, thickness: 1.5, color: purple });
      }
    }
    draw(page, report.trend[0].day, left, bottom - 20, 9, muted);
    draw(page, report.trend.at(-1)!.day, left + width - 70, bottom - 20, 9, muted);
    draw(page, `$${maximum.toFixed(6)}`, left + 5, bottom + height - 12, 9, muted);
  } else draw(page, '当前筛选条件下暂无费用', 65, 285, 12, muted);
  draw(page, '费用明细见后续页面。费用以运行时价格快照和账本为准。', 40, 85, 10, muted);
  for (let offset = 0; offset < report.breakdown.length; offset += 20) {
    const sheet = pdf.addPage(size);
    draw(sheet, `费用分摊 · ${Math.floor(offset / 20) + 1}`, 40, 540, 17);
    draw(sheet, '名称', 44, 505, 10, purple);
    draw(sheet, '费用 USD', 440, 505, 10, purple);
    draw(sheet, '计费部分数', 690, 505, 10, purple);
    report.breakdown.slice(offset, offset + 20).forEach((item, index) => {
      const y = 480 - index * 22;
      if (index % 2 === 0) sheet.drawRectangle({ x: 40, y: y - 5, width: 760, height: 21, color: rgb(.96, .96, .99) });
      draw(sheet, fit(item.name, 370), 44, y, 9);
      draw(sheet, `$${item.costUsd}`, 440, y, 9);
      draw(sheet, String(item.runParts), 690, y, 9);
    });
  }
  return new Blob([new Uint8Array(await pdf.save())], { type: 'application/pdf' });
}
