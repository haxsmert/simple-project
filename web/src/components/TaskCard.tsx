import type { DragEvent } from 'react';
import type { BoardCard, Actor, EdgeType } from '../types';
import { ActorBadge } from './ActorBadge';
import { RoleChip } from './RoleChip';
import { EdgeChip } from './EdgeChip';

// 卡片顶部可展示的"值得一提"关系边类型 → 展示文案(depends_on/spawns 出边)
// 注: clarifies 出边故意不在此列 —— 待决策子任务卡已由 state 驱动的"待决策"阻塞 chip 表达该关系,
// 若再加一个"待确认"边 chip 会与其重复(见 TaskCard 复审修复 · Fix 1)。
const NOTABLE_OUT_LABEL: Partial<Record<EdgeType, string>> = {
  depends_on: '依赖', spawns: '引出',
};
const MAX_EDGE_CHIPS = 2;
// 优先级用文字(高/中/低)承载, 颜色只作强化 —— 不靠颜色单独传意, 灰度/色盲也能区分
const PRIO_LABEL: Record<'hi' | 'mid' | 'lo', string> = { hi: '高', mid: '中', lo: '低' };

export function TaskCard({ task, actor, onOpen, draggable, dragging, onDragStart, onDragOver, onDrop, onDragEnd }: {
  task: BoardCard; actor: Actor | null; onOpen: (id: string) => void;
  draggable?: boolean; dragging?: boolean;
  onDragStart?: (e: DragEvent<HTMLDivElement>) => void; onDragOver?: (e: DragEvent<HTMLDivElement>) => void;
  onDrop?: (e: DragEvent<HTMLDivElement>) => void; onDragEnd?: (e: DragEvent<HTMLDivElement>) => void;
}) {
  const blocked = task.state === 'awaiting_decision';

  // 关系边 chip: 出边按类型去重, 再补一个"被依赖"的入边, 最后按上限截断避免拥挤
  const chips: { key: string; type: EdgeType; label: string }[] = [];
  const seenTypes = new Set<EdgeType>();
  for (const e of task.edges?.out ?? []) {
    const label = NOTABLE_OUT_LABEL[e.type];
    if (label && !seenTypes.has(e.type)) {
      seenTypes.add(e.type);
      chips.push({ key: e.id, type: e.type, label });
    }
  }
  if (!seenTypes.has('depends_on')) {
    const incomingDep = (task.edges?.in ?? []).find((e) => e.type === 'depends_on');
    if (incomingDep) chips.push({ key: incomingDep.id, type: 'depends_on', label: '被依赖' });
  }
  const visibleChips = chips.slice(0, MAX_EDGE_CHIPS);

  const subtaskCount = task.subtaskCount ?? 0;
  const hasSubtasks = subtaskCount > 0;
  const doneSubtaskCount = task.doneSubtaskCount ?? 0;
  const pct = hasSubtasks ? Math.round((doneSubtaskCount / subtaskCount) * 100) : 0;

  return (
    <div className={`card${blocked ? ' blocked' : ''}${dragging ? ' dragging' : ''}`} onClick={() => onOpen(task.id)}
      role="button" tabIndex={0} aria-label={`${task.title} · ${task.id}`}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpen(task.id); } }}
      draggable={draggable} onDragStart={onDragStart} onDragOver={onDragOver} onDrop={onDrop} onDragEnd={onDragEnd}>
      {task.parentTitle && <div className="card-project">{task.parentTitle}</div>}
      <div className="card-top">
        <RoleChip role={task.currentRole} />
        {blocked && <EdgeChip type="clarifies" label="待决策" />}
        {visibleChips.map((c) => <EdgeChip key={c.key} type={c.type} label={c.label} />)}
        {!!task.attention && task.attention > 0 && <span className="attn-chip">{task.attention} 待决策</span>}
      </div>
      <p className="card-title">{task.title}</p>
      {hasSubtasks && (
        <div className="sub-mini">
          <span className="bar"><i style={{ width: `${pct}%` }} /></span>
          子任务 {doneSubtaskCount}/{subtaskCount}
        </div>
      )}
      <div className="card-foot">
        <ActorBadge actor={actor} />
        <span className="card-meta">
          {task.priority && <span className={`prio ${task.priority}`} title={`优先级 ${PRIO_LABEL[task.priority]}`}>{PRIO_LABEL[task.priority]}</span>}
          <span className="card-id">{task.id}</span>
        </span>
      </div>
    </div>
  );
}
