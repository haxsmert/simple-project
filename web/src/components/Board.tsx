import type { ReactNode } from 'react';
import { useState } from 'react';
import type { BoardColumn, TaskState, Actor } from '../types';
import { TaskCard } from './TaskCard';

const NAME: Record<TaskState, string> = { planning: '待规划', awaiting_confirm: '待确认', executing: '执行中', awaiting_decision: '待决策', testing: '测试中', done: '完成' };
const STRIPE: Record<TaskState, string> = { planning: 'var(--text-faint)', awaiting_confirm: '#8b7bd8', executing: 'var(--human)', awaiting_decision: 'var(--warn)', testing: '#37a6b3', done: 'var(--done)' };

// 纯函数: 计算"把 dragId 插到 dropId 之前"后的新顺序 —— 不依赖 DOM/事件, 便于在 jsdom 之外单测拖拽排序算法本身。
// dropId 为 null 时表示拖到列尾(空白区域 drop), 直接把 dragId 追加到末尾。
export function reorderIds(currentIds: string[], dragId: string, dropId: string | null): string[] {
  const ids = currentIds.filter((id) => id !== dragId);
  if (dropId === null || dropId === dragId) {
    ids.push(dragId);
    return ids;
  }
  const idx = ids.indexOf(dropId);
  if (idx === -1) {
    ids.push(dragId);
    return ids;
  }
  ids.splice(idx, 0, dragId);
  return ids;
}

export function Board({ columns, actorsById, onOpen, onReorder, emptyHint }: {
  columns: BoardColumn[]; actorsById: Record<string, Actor>; onOpen: (id: string) => void;
  onReorder?: (ids: string[]) => void; emptyHint?: ReactNode;
}) {
  const [dragId, setDragId] = useState<string | null>(null);
  const [dragState, setDragState] = useState<string | null>(null);

  const total = columns.reduce((s, c) => s + c.tasks.length, 0);
  if (total === 0 && emptyHint) {
    return <div className="board-empty">{emptyHint}</div>;
  }
  return (
    <div className="board">
      {columns.map((col) => (
        <div key={col.state} className={`col${col.state === 'awaiting_decision' ? ' attn' : ''}`}>
          <div className="col-head">
            <span className="stripe" style={{ background: STRIPE[col.state] }} />
            <span className="name">{NAME[col.state]}</span>
            <span className="cnt">{col.tasks.length}</span>
          </div>
          <div className="cards"
            onDragOver={(e) => { if (dragState === col.state && dragId) e.preventDefault(); }}
            onDrop={(e) => {
              e.preventDefault();
              if (!dragId || dragState !== col.state) return;
              onReorder?.(reorderIds(col.tasks.map((t) => t.id), dragId, null));
            }}>
            {col.tasks.length === 0
              ? <div className="col-empty">暂无</div>
              : col.tasks.map((t) => (
                <TaskCard key={t.id} task={t} actor={t.currentActor ? actorsById[t.currentActor] ?? null : null} onOpen={onOpen}
                  draggable={!!onReorder} dragging={dragId === t.id}
                  onDragStart={() => { setDragId(t.id); setDragState(col.state); }}
                  onDragEnd={() => { setDragId(null); setDragState(null); }}
                  onDragOver={(e) => { if (dragState === col.state && dragId) e.preventDefault(); }}
                  onDrop={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    if (!dragId || dragState !== col.state || dragId === t.id) return;
                    onReorder?.(reorderIds(col.tasks.map((x) => x.id), dragId, t.id));
                  }} />
              ))}
          </div>
        </div>
      ))}
    </div>
  );
}
