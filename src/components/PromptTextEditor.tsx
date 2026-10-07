import { useRef } from 'react';

interface Props { value?: string; onChange?: (value: string) => void; rows?: number; placeholder?: string }
export default function PromptTextEditor({ value = '', onChange, rows = 12, placeholder }: Props) {
  const preview = useRef<HTMLPreElement>(null);
  const render = value.split(/(\{\{[A-Za-z_][A-Za-z0-9_]*\}\})/g).map((part, index) => part.startsWith('{{') ? <mark key={index} style={{ color: '#e6bb77', background: 'transparent' }}>{part}</mark> : part);
  return <div style={{ position: 'relative', minHeight: rows * 22 + 24, border: '1px solid #30364c', borderRadius: 8, overflow: 'hidden', background: '#101426' }}>
    <pre ref={preview} aria-hidden="true" style={{ position: 'absolute', inset: 0, margin: 0, padding: 12, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', font: '13px/22px monospace', pointerEvents: 'none', color: '#e8eaf4' }}>{render}{'\n'}</pre>
    <textarea aria-label={placeholder || '提示词正文'} spellCheck={false} value={value} placeholder={placeholder} onChange={event => onChange?.(event.target.value)} onScroll={event => { if (preview.current) { preview.current.scrollTop = event.currentTarget.scrollTop; preview.current.scrollLeft = event.currentTarget.scrollLeft; } }} style={{ position: 'relative', display: 'block', width: '100%', minHeight: rows * 22 + 24, resize: 'vertical', padding: 12, border: 0, outline: 'none', background: 'transparent', color: 'transparent', caretColor: '#e8eaf4', font: '13px/22px monospace', overflowWrap: 'anywhere' }} />
  </div>;
}
