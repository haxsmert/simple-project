import type { EdgeType } from '../types';

// 关系边只有两种说得清的(2026-07-18 语义大扫除): 依赖 / 待确认
const CFG: Record<EdgeType, { cls: string; label: string }> = {
  depends_on: { cls: 'dep', label: '依赖' },
  clarifies: { cls: 'await', label: '待确认' },
};

export function EdgeChip({ type, label }: { type: EdgeType; label?: string }) {
  const c = CFG[type];
  return (<span className={`edge ${c.cls}`}>{label ?? c.label}</span>);
}
