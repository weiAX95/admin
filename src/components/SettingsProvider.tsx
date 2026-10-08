import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { ConfigProvider, theme } from 'antd';
import zhCN from 'antd/locale/zh_CN';
import enUS from 'antd/locale/en_US';
import { getToken } from '../api/client';
import { getPreferences, getPublicSettings, type Preferences, type PublicSettings } from '../api/settings';

const fallback: PublicSettings = { systemName: 'Agent 学习管理端', logoUrl: null, defaultTimezone: 'Asia/Shanghai', defaultLanguage: 'zh-CN', defaultDateFormat: 'YYYY-MM-DD', defaultPageSize: 20 };
const SettingsContext = createContext<{ brand: PublicSettings; preferences: Preferences | null; refresh: () => Promise<void>; language: 'zh-CN' | 'en-US'; pageSize: number } | null>(null);
export function useSettings() {
  const value = useContext(SettingsContext);
  if (!value) throw new Error('SettingsProvider missing');
  return value;
}
export default function SettingsProvider({ children }: { children: React.ReactNode }) {
  const [brand, setBrand] = useState<PublicSettings>(fallback);
  const [preferences, setPreferences] = useState<Preferences | null>(null);
  const refresh = useCallback(async () => {
    const current = await getPublicSettings();
    setBrand(current);
    setPreferences(getToken() ? await getPreferences().catch(() => null) : null);
  }, []);
  useEffect(() => { void refresh().catch(() => undefined); }, [refresh]);
  useEffect(() => {
    const onFocus = () => { void refresh().catch(() => undefined); };
    window.addEventListener('focus', onFocus);
    window.addEventListener('settings-updated', onFocus);
    return () => { window.removeEventListener('focus', onFocus); window.removeEventListener('settings-updated', onFocus); };
  }, [refresh]);
  const language = preferences?.language || brand.defaultLanguage;
  const light = preferences?.theme === 'light';
  const primary = preferences?.primaryColor || '#9582ff';
  const context = useMemo(() => ({ brand, preferences, refresh, language, pageSize: brand.defaultPageSize }), [brand, preferences, refresh, language]);
  useEffect(() => {
    document.documentElement.lang = language;
    document.documentElement.dataset.theme = light ? 'light' : 'dark';
    document.documentElement.dataset.density = preferences?.density || 'comfortable';
    document.documentElement.style.setProperty('--brand-primary', primary);
    document.title = brand.systemName;
  }, [brand.systemName, language, light, preferences?.density, primary]);
  return <SettingsContext.Provider value={context}>
    <ConfigProvider locale={language === 'en-US' ? enUS : zhCN} theme={{
      algorithm: light ? theme.defaultAlgorithm : theme.darkAlgorithm,
      token: { colorPrimary: primary, borderRadius: 10, controlHeight: preferences?.density === 'compact' ? 32 : 38,
        fontFamily: 'Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif',
        ...(!light ? { colorBgContainer: '#141726', colorBgElevated: '#1a1e30', colorBgLayout: '#0b0d17', colorBorder: '#30364c', colorBorderSecondary: '#252b40' } : {}),
      },
      components: { Table: { cellPaddingBlock: preferences?.density === 'compact' ? 10 : 18 } },
    }}>
      {children}
    </ConfigProvider>
  </SettingsContext.Provider>;
}
