import { useEffect, useState } from 'react';
import { App, Button, Card, Col, Form, Input, InputNumber, Row, Select, Space, Switch, Typography, Upload } from 'antd';
import { UploadOutlined } from '@ant-design/icons';
import { getGlobalSettings, getPreferences, saveGlobalSettings, savePreferences, type GlobalSettings, type Preferences } from '../api/settings';
import { getStoredUser, getToken } from '../api/client';
import type { AuthUser } from '../types';
import { useSettings } from '../components/SettingsProvider';
import ModelConnectionsSettings from '../components/ModelConnectionsSettings';
import SessionModelPriceSettings from '../components/SessionModelPriceSettings';
import RetentionSettings from '../components/RetentionSettings';
import BackupSettings from '../components/BackupSettings';
import WebhookSettings from '../components/WebhookSettings';
import { getVersionInfo, type VersionInfo } from '../api/version-info';

const languageOptions = [{ value: 'zh-CN', label: '简体中文' }, { value: 'en-US', label: 'English' }];
const dateOptions = ['YYYY-MM-DD', 'MM/DD/YYYY', 'DD/MM/YYYY'].map(value => ({ value, label: value }));
const primaryPresets = ['#9582ff', '#1677ff', '#13a8a8', '#389e0d', '#d46b08', '#cf1322'];
export default function Settings() {
  const { message } = App.useApp();
  const { refresh, brand, previewPreferences } = useSettings();
  const admin = getStoredUser<AuthUser>()?.role === 'admin';
  const [global, setGlobal] = useState<GlobalSettings | null>(null);
  const [personal, setPersonal] = useState<Preferences | null>(null);
  const [saving, setSaving] = useState(false);
  const [versionInfo, setVersionInfo] = useState<VersionInfo | null>(null);
  const [globalForm] = Form.useForm<GlobalSettings>();
  const [personalForm] = Form.useForm<Preferences>();
  const logoPreview = Form.useWatch('logoUrl', globalForm);
  const load = async () => {
    const [g, p] = await Promise.all([admin ? getGlobalSettings() : Promise.resolve(null), getPreferences()]);
    setGlobal(g); setPersonal(p);
    if (g) globalForm.setFieldsValue(g);
    personalForm.setFieldsValue(p);
  };
  useEffect(() => { void load().catch(error => message.error(error.message)); }, []);
  useEffect(() => { void getVersionInfo().then(setVersionInfo).catch(() => undefined); }, []);
  const saveGlobal = async (values: GlobalSettings) => {
    if (!global) return;
    setSaving(true);
    try {
      const next = await saveGlobalSettings({ ...global, ...values });
      setGlobal(next); globalForm.setFieldsValue(next); await refresh();
      window.dispatchEvent(new Event('settings-updated'));
      message.success('全局设置已保存');
    } catch (error) { message.error(error instanceof Error ? error.message : '保存失败'); }
    finally { setSaving(false); }
  };
  const savePersonal = async (values: Preferences) => {
    if (!personal) return;
    setSaving(true);
    try {
      const next = await savePreferences({ ...personal, ...values });
      setPersonal(next); personalForm.setFieldsValue(next); await refresh();
      window.dispatchEvent(new Event('settings-updated'));
      message.success('个人偏好已保存');
    } catch (error) { message.error(error instanceof Error ? error.message : '保存失败'); }
    finally { setSaving(false); }
  };
  const applyAppearance = async <K extends 'theme' | 'primaryColor' | 'density'>(key: K, value: Preferences[K]) => {
    if (!personal || saving || personal[key] === value) return;
    const previous = personal;
    const pending = { ...personal, [key]: value };
    setSaving(true);
    setPersonal(pending);
    previewPreferences(pending);
    try {
      const next = await savePreferences(pending);
      setPersonal(next);
      previewPreferences(next);
    } catch (error) {
      const latest = await getPreferences().catch(() => previous);
      setPersonal(latest);
      previewPreferences(latest);
      message.error(error instanceof Error ? error.message : '外观设置保存失败');
    } finally { setSaving(false); }
  };
  const uploadLogo = async (file: File) => {
    try {
      const response = await fetch('/api/assets', { method: 'POST', headers: { Authorization: `Bearer ${getToken()}`, 'Content-Type': file.type }, body: file });
      const result = await response.json() as { url?: string; error?: string };
      if (!response.ok || !result.url) throw new Error(result.error || '上传失败');
      globalForm.setFieldValue('logoUrl', result.url);
      message.success('Logo 已上传，请保存全局设置');
    } catch (error) { message.error(error instanceof Error ? error.message : '上传失败'); }
    return false;
  };
  return <Space direction="vertical" size={20} style={{ display: 'flex' }}>
    {admin && <Card title="全局设置" loading={!global}>
      <Form form={globalForm} layout="vertical" onFinish={saveGlobal}>
        <Row gutter={20}>
          <Col xs={24} md={12}><Form.Item name="systemName" label="系统名称" rules={[{ required: true, max: 100 }]}><Input /></Form.Item></Col>
          <Col xs={24} md={12}><Form.Item name="logoUrl" label="系统 Logo"><Input placeholder="上传后自动填充" /></Form.Item><Space style={{ marginBottom: 16 }}><Upload showUploadList={false} accept="image/png,image/jpeg,image/webp,image/gif" beforeUpload={uploadLogo}><Button icon={<UploadOutlined />}>上传图片</Button></Upload>{logoPreview && <img src={logoPreview} alt="Logo 预览" style={{ maxWidth: 56, maxHeight: 56 }} />}</Space></Col>
          <Col xs={24} md={12}><Form.Item name="defaultTimezone" label="默认时区" rules={[{ required: true }]}><Input placeholder="Asia/Shanghai" /></Form.Item></Col>
          <Col xs={24} md={12}><Form.Item name="defaultLanguage" label="默认语言"><Select options={languageOptions} /></Form.Item></Col>
          <Col xs={24} md={12}><Form.Item name="defaultDateFormat" label="默认日期格式"><Select options={dateOptions} /></Form.Item></Col>
          <Col xs={24} md={12}><Form.Item name="defaultPageSize" label="默认分页条数"><Select options={[10,20,50,100].map(value => ({ value, label: `${value} 条` }))} /></Form.Item></Col>
          <Col xs={24} md={12}><Form.Item name="sessionHours" label="新登录有效期（小时）"><InputNumber min={1} max={720} style={{ width: '100%' }} /></Form.Item></Col>
        </Row>
        <Typography.Text type="secondary">有效期只影响新登录，现有令牌保持原到期时间。</Typography.Text><br /><br />
        <Button type="primary" htmlType="submit" loading={saving}>保存全局设置</Button>
      </Form>
    </Card>}
    {admin && <ModelConnectionsSettings />}
    {admin && <SessionModelPriceSettings />}
    {admin && <RetentionSettings />}
    {admin && <BackupSettings />}
    {admin && <WebhookSettings />}
    <Card title="个人偏好" loading={!personal}>
      <Form form={personalForm} layout="vertical" onFinish={savePersonal}>
        <Row gutter={20}>
          <Col xs={24} md={12}><Form.Item name="timezone" label="个人时区"><Input placeholder={brand.defaultTimezone} /></Form.Item></Col>
          <Col xs={24} md={12}><Form.Item name="language" label="语言"><Select allowClear placeholder="使用系统默认" options={languageOptions} /></Form.Item></Col>
          <Col xs={24} md={12}><Form.Item name="dateFormat" label="日期格式"><Select allowClear placeholder="使用系统默认" options={dateOptions} /></Form.Item></Col>
          <Col xs={24} md={12}><Form.Item label="主题"><Space><Switch aria-label="亮色主题" checked={personal?.theme === 'light'} checkedChildren="亮色" unCheckedChildren="暗色" disabled={saving} onChange={checked => void applyAppearance('theme', checked ? 'light' : 'dark')} /><Typography.Text type="secondary">切换后自动保存</Typography.Text></Space></Form.Item></Col>
          <Col xs={24} md={12}><Form.Item label="布局密度"><Space><Switch aria-label="紧凑布局" checked={personal?.density === 'compact'} checkedChildren="紧凑" unCheckedChildren="宽松" disabled={saving} onChange={checked => void applyAppearance('density', checked ? 'compact' : 'comfortable')} /><Typography.Text type="secondary">切换后自动保存</Typography.Text></Space></Form.Item></Col>
          <Col xs={24}><Form.Item label="主色"><Space wrap className="settings-color-presets">{primaryPresets.map(color => <button key={color} type="button" className="settings-color-preset" style={{ background: color }} aria-label={`选择主色 ${color}`} aria-pressed={personal?.primaryColor.toLowerCase() === color} disabled={saving} onClick={() => void applyAppearance('primaryColor', color)} />)}<input aria-label="自定义主色" type="color" value={personal?.primaryColor || '#9582ff'} disabled={saving} onChange={event => void applyAppearance('primaryColor', event.target.value)} /></Space></Form.Item></Col>
        </Row>
        <Button type="primary" htmlType="submit" loading={saving}>保存个人偏好</Button>
      </Form>
    </Card>
    <Card title="更新日志" extra={<Typography.Text type="secondary">当前版本 v{versionInfo?.currentVersion || '—'}</Typography.Text>}>
      {versionInfo?.changelog.map(entry => {
        const copy = (personal?.language || brand.defaultLanguage) === 'en-US' ? entry.en : entry.zh;
        return <div key={entry.version} style={{ marginBottom: 20 }}><Typography.Title level={5}>v{entry.version} · {copy.title}</Typography.Title><Typography.Text type="secondary">{entry.date}</Typography.Text><ul>{copy.changes.map(change => <li key={change}>{change}</li>)}</ul></div>;
      })}
    </Card>
  </Space>;
}
