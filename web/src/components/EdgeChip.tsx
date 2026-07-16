import type { EdgeType } from '../types';

const CFG: Record<EdgeType, { cls: string; label: string }> = {
  blocks: { cls: 'block', label: '阻塞' },
  depends_on: { cls: 'dep', label: '依赖' },
  clarifies: { cls: 'await', label: '待确认' },
  spawns: { cls: 'spawn', label: '引出' },
};

export function EdgeChip({ type, label }: { type: EdgeType; label?: string }) {
  const c = CFG[type];
  return (<span className={`edge ${c.cls}`}>{label ?? c.label}</span>);
}
