import type { RegressionReport } from '../api/experiment-evaluation';

export async function makeRegressionPdf(report: RegressionReport, fontBytes?: ArrayBuffer | Uint8Array): Promise<Blob> {
  const [{ PDFDocument, rgb }, { default: fontkit }] = await Promise.all([import('pdf-lib'), import('@pdf-lib/fontkit')]);
  const bytes = fontBytes ?? await fetch('/fonts/NotoSansCJKsc-Regular.otf').then(response => { if (!response.ok) throw new Error('中文字体加载失败'); return response.arrayBuffer(); });
  const pdf = await PDFDocument.create(); pdf.registerFontkit(fontkit);
  if (!bytes) throw new Error('中文字体加载失败');
  const font = await pdf.embedFont(bytes);
  pdf.setTitle('实验回归评测报告');
  const dark = rgb(.12,.14,.21), muted=rgb(.35,.38,.47), purple=rgb(.58,.51,1), yellow=rgb(.94,.75,.39);
  const pageSize: [number,number] = [842,595];
  const page = pdf.addPage(pageSize);
  const draw = (text: string, x: number, y: number, size=10, color=dark, sheet=page) => sheet.drawText(text, { x,y,font,size,color });
  const fit = (value: string, width: number, size=9) => { let result=String(value || ''); while (result && font.widthOfTextAtSize(result,size)>width-6) result=result.slice(0,-1); return result===value ? result : `${result.slice(0,-1)}…`; };
  draw('实验回归评测报告',40,540,23);
  draw(`生成时间：${new Date().toLocaleString('zh-CN',{timeZone:'Asia/Shanghai',hour12:false})}`,40,510,10,muted);
  draw(`数据集版本 ${report.datasetVersionId}   指标版本 ${report.metricVersionId}`,40,485,9,muted);
  draw(`用例 ${report.total}   有效评分 ${report.scored}   通过率 ${report.passRate === null ? '暂无数据' : `${(report.passRate*100).toFixed(1)}%`}`,40,450,15,purple);
  draw(`固定 baseline：${report.baselineBatchId}   退化阈值 ${report.regressionThreshold}`,40,420,10);
  draw('评分分布（箱线图）',40,380,13);
  if (report.box) {
    const x = (value: number) => 80 + value/5*570;
    page.drawLine({start:{x:80,y:320},end:{x:650,y:320},thickness:1,color:muted});
    for(let i=0;i<=5;i++) draw(String(i),x(i)-3,303,9,muted);
    page.drawLine({start:{x:x(report.box.min),y:342},end:{x:x(report.box.max),y:342},thickness:2,color:purple});
    page.drawRectangle({x:x(report.box.q1),y:326,width:Math.max(2,x(report.box.q3)-x(report.box.q1)),height:32,color:rgb(.88,.85,1),borderColor:purple,borderWidth:1});
    page.drawLine({start:{x:x(report.box.median),y:326},end:{x:x(report.box.median),y:358},thickness:2,color:purple});
    for(const value of [report.box.min,report.box.max]) page.drawLine({start:{x:x(value),y:334},end:{x:x(value),y:350},thickness:1,color:purple});
  } else draw('暂无有效评分',40,330,11,muted);
  draw('按难度',40,268,12); draw('按分类',420,268,12);
  report.byDifficulty.slice(0,6).forEach((item,index)=>draw(`${fit(item.name,120)}：${item.count} 条，通过率 ${item.passRate===null?'—':`${(item.passRate*100).toFixed(1)}%`}`,40,245-index*23,9));
  report.byCategory.slice(0,6).forEach((item,index)=>draw(`${fit(item.name,120)}：${item.count} 条，通过率 ${item.passRate===null?'—':`${(item.passRate*100).toFixed(1)}%`}`,420,245-index*23,9));
  draw(`退化用例 ${report.degraded.length} 条，明细见后续页面。`,40,65,11,report.degraded.length?yellow:muted);
  const rows = report.cases;
  for(let offset=0;offset<rows.length;offset+=20){
    const sheet=pdf.addPage(pageSize);
    draw(`逐用例对比 · ${Math.floor(offset/20)+1}`,40,540,18,dark,sheet);
    const columns=[['用例 ID',40],['分类',200],['难度',300],['当前评分',400],['基线评分',505],['差值',615],['结果',705]] as const;
    for(const [label,x] of columns) draw(label,x,508,9,purple,sheet);
    rows.slice(offset,offset+20).forEach((item,index)=>{
      const y=482-index*21;
      if(index%2===0) sheet.drawRectangle({x:37,y:y-5,width:766,height:20,color:rgb(.96,.96,.99)});
      draw(fit(item.caseKey,145),40,y,9,dark,sheet); draw(fit(item.category,90),200,y,9,dark,sheet);draw(fit(item.difficulty,90),300,y,9,dark,sheet);
      draw(item.score===null?'—':item.score.toFixed(2),400,y,9,dark,sheet);draw(item.baselineScore.toFixed(2),505,y,9,dark,sheet);
      draw(item.delta===null?'—':item.delta.toFixed(2),615,y,9,item.delta!==null&&item.delta<0?yellow:dark,sheet);
      draw(item.delta!==null&&item.delta < -report.regressionThreshold?'退化':item.passed?'通过':'未通过',705,y,9,dark,sheet);
    });
  }
  return new Blob([new Uint8Array(await pdf.save())],{type:'application/pdf'});
}
