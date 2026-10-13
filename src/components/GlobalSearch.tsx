import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { Button, Empty, Input, Modal, Spin, Typography } from 'antd';
import type { InputRef } from 'antd';
import { SearchOutlined } from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';
import { searchGlobally, type GlobalSearchHit, type GlobalSearchType } from '../api/globalSearch';

const GROUPS: { type: GlobalSearchType; label: string }[] = [
  { type: 'task', label: '任务' },
  { type: 'note', label: '笔记' },
  { type: 'session', label: '会话' },
  { type: 'experiment', label: '实验' },
  { type: 'prompt', label: '提示词' },
  { type: 'case', label: '评测用例' },
];

export default function GlobalSearch() {
  const navigate = useNavigate();
  const inputRef = useRef<InputRef>(null);
  const requestRef = useRef(0);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [items, setItems] = useState<GlobalSearchHit[]>([]);
  const [active, setActive] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    const shortcut = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setOpen(true);
      }
    };
    window.addEventListener('keydown', shortcut);
    return () => window.removeEventListener('keydown', shortcut);
  }, []);

  useEffect(() => {
    const request = ++requestRef.current;
    const term = query.trim();
    setItems([]);
    setActive(0);
    setError('');
    if (!open || !term) { setLoading(false); return; }
    setLoading(true);
    const timer = window.setTimeout(() => {
      void searchGlobally(term).then(result => {
        if (request === requestRef.current) setItems(result.items);
      }).catch(cause => {
        if (request === requestRef.current) setError(cause instanceof Error ? cause.message : '搜索失败');
      }).finally(() => {
        if (request === requestRef.current) setLoading(false);
      });
    }, 160);
    return () => window.clearTimeout(timer);
  }, [open, query, retry]);

  const close = () => { setOpen(false); setQuery(''); };
  const visit = (item: GlobalSearchHit) => { close(); navigate(item.href); };
  const onKeyDown = (event: ReactKeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'ArrowDown') { event.preventDefault(); setActive(index => items.length ? Math.min(items.length - 1, index + 1) : 0); }
    if (event.key === 'ArrowUp') { event.preventDefault(); setActive(index => Math.max(0, index - 1)); }
    if (event.key === 'Enter' && items[active]) { event.preventDefault(); visit(items[active]); }
    if (event.key === 'Escape') close();
  };

  return <>
    <Button type="text" icon={<SearchOutlined />} className="global-search-trigger" aria-label="全局搜索，快捷键 Command K 或 Control K" onClick={() => setOpen(true)}>搜索 <kbd>⌘K / Ctrl+K</kbd></Button>
    <Modal title="全局搜索" open={open} onCancel={close} footer={null} width={680} afterOpenChange={visible => { if (visible) inputRef.current?.focus(); }} destroyOnClose>
      <Input ref={inputRef} prefix={<SearchOutlined />} size="large" placeholder="搜索任务、笔记、会话、实验、提示词和评测用例" value={query} maxLength={120}
        role="combobox" aria-label="全局搜索关键词" aria-expanded={open} aria-controls="global-search-results" aria-activedescendant={items[active] ? `global-search-option-${active}` : undefined}
        onChange={event => setQuery(event.target.value)} onKeyDown={onKeyDown} />
      <div id="global-search-results" className="global-search-results" role="listbox" aria-label="搜索结果" aria-busy={loading}>
        {loading ? <div className="global-search-state"><Spin size="small" /> 正在搜索…</div>
          : error ? <div className="global-search-state" role="alert"><Typography.Text type="danger">{error}</Typography.Text><Button size="small" onClick={() => setRetry(value => value + 1)}>重试</Button></div>
          : !query.trim() ? <div className="global-search-state">输入关键词开始搜索；用 ↑↓ 选择，按 Enter 打开。</div>
          : !items.length ? <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="未找到匹配结果" />
          : GROUPS.map(group => {
            const hits = items.filter(item => item.type === group.type);
            if (!hits.length) return null;
            return <div key={group.type} className="global-search-group" role="group" aria-label={group.label}>
              <div className="global-search-group-title">{group.label}</div>
              {hits.map(item => {
                const index = items.indexOf(item);
                return <button id={`global-search-option-${index}`} role="option" aria-selected={index === active} type="button" key={`${item.type}:${item.id}`} className="global-search-item"
                  onMouseEnter={() => setActive(index)} onClick={() => visit(item)}>
                  <strong>{item.title}</strong>{item.preview && <span>{item.preview}</span>}
                </button>;
              })}
            </div>;
          })}
      </div>
    </Modal>
  </>;
}
