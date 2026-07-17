import { useState, useRef, useEffect } from 'react';

export function ProjectPicker({ projects, value, onChange }: {
  projects: Array<{ id: string; title: string }>;
  value: string; // 'all' 或 项目 id
  onChange: (v: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const ref = useRef<HTMLDivElement>(null);
  const label = value === 'all' ? '全部任务' : (projects.find((p) => p.id === value)?.title ?? value);
  const filtered = projects.filter((p) => p.title.toLowerCase().includes(query.toLowerCase()));

  const close = () => { setOpen(false); setQuery(''); };

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) close(); };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') close(); };
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDoc); document.removeEventListener('keydown', onKey); };
  }, [open]);

  const pick = (v: string) => { onChange(v); close(); };

  return (
    <div className="picker" ref={ref}>
      <button className="picker-btn" onClick={() => setOpen((o) => !o)}>
        <span className="picker-label">{label}</span>
        <span className="caret">▾</span>
      </button>
      {open && (
        <div className="picker-pop">
          <input autoFocus placeholder="搜索项目…" value={query} onChange={(e) => setQuery(e.target.value)} />
          {/* 选项是真按钮: div+onClick 对键盘/读屏是死路(能搜到却选不了) */}
          <button type="button" className={`picker-opt${value === 'all' ? ' sel' : ''}`} onClick={() => pick('all')}>全部任务</button>
          {filtered.map((p) => (
            <button type="button" key={p.id} className={`picker-opt${value === p.id ? ' sel' : ''}`} onClick={() => pick(p.id)}>{p.title}</button>
          ))}
          {filtered.length === 0 && <div className="picker-empty">无匹配项目</div>}
        </div>
      )}
    </div>
  );
}
