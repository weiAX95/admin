import { useEffect, useMemo, useRef, useState } from "react";
import { Alert, App, Button, Checkbox, Drawer, Input, Select, Space, Spin, Table, Typography } from "antd";
import type { CsvImportRow } from "../types";
import { importTasksCsv, previewTasksCsv } from "../api/tasks";
import { autoMapHeaders, decodeCsv, IMPORT_FIELDS, mapCsvRows, parseCsv, type ImportField, type ParsedCsv } from "../utils/taskCsv";

interface Props { open: boolean; onClose: () => void; onImported: () => void; }
export default function TaskCsvImport({ open, onClose, onImported }: Props) {
  const { message } = App.useApp();
  const [file, setFile] = useState<File | null>(null);
  const [encoding, setEncoding] = useState<"auto" | "utf-8" | "gbk">("auto");
  const [detected, setDetected] = useState("");
  const [parsed, setParsed] = useState<ParsedCsv | null>(null);
  const [mapping, setMapping] = useState<(ImportField | "")[]>([]);
  const [parseError, setParseError] = useState("");
  const [previewError, setPreviewError] = useState("");
  const [skipInvalid, setSkipInvalid] = useState(false);
  const [checking, setChecking] = useState(false);
  const [saving, setSaving] = useState(false);
  const [serverErrors, setServerErrors] = useState<Record<number, string>>({});
  const [previewTime, setPreviewTime] = useState<number | null>(null);
  const generation = useRef(0);

  useEffect(() => { if (!open) { setFile(null); setParsed(null); setMapping([]); setParseError(""); setPreviewError(""); setServerErrors({}); setSkipInvalid(false); setEncoding("auto"); setDetected(""); setPreviewTime(null); } }, [open]);
  useEffect(() => {
    if (!file || !open) return;
    let alive = true;
    const started = performance.now();
    void file.arrayBuffer().then(bytes => {
      const decoded = decodeCsv(bytes, encoding);
      const result = parseCsv(decoded.text);
      if (!alive) return;
      setDetected(decoded.encoding);
      setParsed(result);
      setMapping(autoMapHeaders(result.headers));
      setParseError("");
      setPreviewTime(Math.round(performance.now() - started));
    }).catch(error => { if (alive) { setParsed(null); setParseError(error instanceof Error ? error.message : "CSV 解析失败"); } });
    return () => { alive = false; };
  }, [file, encoding, open]);

  const mapped = useMemo(() => {
    if (!parsed) return { rows: [] as CsvImportRow[], error: "" };
    try { return { rows: mapCsvRows(parsed, mapping), error: "" }; }
    catch (error) { return { rows: [] as CsvImportRow[], error: error instanceof Error ? error.message : "列映射无效" }; }
  }, [parsed, mapping]);

  useEffect(() => {
    const id = ++generation.current;
    setServerErrors({});
    setPreviewError("");
    if (!mapped.rows.length || mapped.error) { setChecking(false); return; }
    setChecking(true);
    void previewTasksCsv(mapped.rows).then(result => {
      if (generation.current === id) setServerErrors(Object.fromEntries(result.errors.map(item => [item.rowNumber, item.reason])));
    }).catch(error => { if (generation.current === id) setPreviewError(error instanceof Error ? error.message : "预览校验失败"); })
      .finally(() => { if (generation.current === id) setChecking(false); });
  }, [mapped]);

  const invalidCount = mapped.rows.filter(row => row.errors?.length || serverErrors[row.rowNumber]).length;
  const submit = async () => {
    if (checking || saving || mapped.error || previewError || !mapped.rows.length || (invalidCount && !skipInvalid)) return;
    setSaving(true);
    const started = performance.now();
    try {
      const result = await importTasksCsv(mapped.rows, skipInvalid);
      const elapsed = Math.round(performance.now() - started);
      message.success(`导入 ${result.imported} 条，跳过 ${result.skipped} 条；提交耗时 ${elapsed} ms`, 6);
      onImported();
      onClose();
    } catch (error) { message.error(error instanceof Error ? error.message : "CSV 导入失败"); }
    finally { setSaving(false); }
  };

  return <Drawer title="导入 CSV 任务" width={780} open={open} onClose={onClose} extra={<Button type="primary" loading={saving} disabled={!mapped.rows.length || checking || !!mapped.error || !!parseError || !!previewError || (invalidCount > 0 && !skipInvalid)} onClick={() => void submit()}>确认导入</Button>}>
    <Space direction="vertical" size={16} style={{ width: "100%" }}>
      <Input type="file" accept=".csv,text/csv" aria-label="选择 CSV 文件" onChange={event => setFile(event.target.files?.[0] || null)} />
      <Space><Typography.Text>编码</Typography.Text><Select aria-label="CSV 编码" value={encoding} style={{ width: 150 }} onChange={setEncoding} options={[{ value: "auto", label: "自动识别" }, { value: "utf-8", label: "UTF-8" }, { value: "gbk", label: "GBK" }]} />{detected && <Typography.Text type="secondary">实际使用：{detected.toUpperCase()}</Typography.Text>}</Space>
      {parseError && <Alert type="error" showIcon message={parseError} />}
      {previewError && <Alert type="error" showIcon message={previewError} />}
      {parsed && <>
        <Typography.Text type="secondary">共 {parsed.rows.length} 行；解析与初次预览 {previewTime ?? "—"} ms。复杂字段请使用 JSON 单元格；文件中的只读系统字段会在回导时重置。</Typography.Text>
        <Typography.Title level={5} style={{ margin: 0 }}>列映射</Typography.Title>
        <div className="csv-mapping-grid">{parsed.headers.map((header, index) => <Space key={`${header}-${index}`} direction="vertical" size={2}><Typography.Text ellipsis title={header}>{header || `第 ${index + 1} 列`}</Typography.Text><Select aria-label={`${header || `第 ${index + 1} 列`} 映射`} style={{ width: "100%" }} value={mapping[index] || ""} onChange={(value: ImportField | "") => setMapping(previous => previous.map((item, i) => i === index ? value : item))} options={[{ value: "", label: "忽略此列" }, ...IMPORT_FIELDS.map(field => ({ value: field, label: field }))]} /></Space>)}</div>
        {mapped.error && <Alert type="error" showIcon message={mapped.error} />}
        <Space><Typography.Text>预览 {mapped.rows.length} 行，发现 {invalidCount} 行无效</Typography.Text>{checking && <Spin size="small" />}</Space>
        <Table size="small" rowKey="rowNumber" dataSource={mapped.rows} pagination={{ pageSize: 10 }} rowClassName={row => row.errors?.length || serverErrors[row.rowNumber] ? "csv-invalid-row" : ""} columns={[
          { title: "原始行", dataIndex: "rowNumber", width: 90 },
          { title: "标题", render: (_, row) => String(row.data.title || "—") },
          { title: "分类", render: (_, row) => String(row.data.category || "—") },
          { title: "状态", render: (_, row) => String(row.data.status || "todo") },
          { title: "校验", render: (_, row) => <Typography.Text type={row.errors?.length || serverErrors[row.rowNumber] ? "danger" : "success"}>{[...(row.errors || []), serverErrors[row.rowNumber]].filter(Boolean).join("；") || "有效"}</Typography.Text> },
        ]} />
        <Checkbox checked={skipInvalid} onChange={event => setSkipInvalid(event.target.checked)}>跳过所有无效行后导入</Checkbox>
      </>}
    </Space>
  </Drawer>;
}
