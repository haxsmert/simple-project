import type { ReactNode } from 'react';
import { useState } from 'react';
import type { BoardColumn, TaskState, Actor } from '../types';
import { TaskCard } from './TaskCard';
import { STATE_NAME as NAME, STATE_COLOR as STRIPE } from '../states';



// 纯函数: 计算把 dragId 插到 dropId 之前(after=false)或之后(after=true)后的新顺序。
// 不依赖 DOM/事件, 便于在 jsdom 之外单测拖拽排序算法本身。
// after 由 drop 时指针落在目标卡的上半/下半决定 —— 只"插到之前"会让向下拖到相邻卡变成空操作、且末位不可达。
// dropId 为 null 时表示拖到列尾(空白区域 drop), 直接把 dragId 追加到末尾。
export function reorderIds(currentIds: string[], dragId: string, dropId: string | null, after = false): string[] {
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
  ids.splice(after ? idx + 1 : idx, 0, dragId);
  return ids;
}

export function Board({ columns, actorsById, onOpen, onDescend, onReorder, showProject, flashId, emptyHint }: {
  columns: BoardColumn[]; actorsById: Record<string, Actor>; onOpen: (id: string) => void;
  onDescend?: (id: string) => void; onReorder?: (ids: string[]) => void; showProject?: boolean;
  flashId?: string | null; // 刚被动作影响的卡: 亮一下, 让"我点了 → 它挪到这列了"的因果可见
  emptyHint?: ReactNode;
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
        <div key={col.state} className="col">
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
                <TaskCard key={t.id} task={t} actor={t.currentActor ? actorsById[t.currentActor] ?? null : null} onOpen={onOpen} onDescend={onDescend} showProject={showProject} flash={flashId === t.id}
                  draggable={!!onReorder} dragging={dragId === t.id}
                  onDragStart={() => { setDragId(t.id); setDragState(col.state); }}
                  onDragEnd={() => { setDragId(null); setDragState(null); }}
                  onDragOver={(e) => { if (dragState === col.state && dragId) e.preventDefault(); }}
                  onDrop={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    if (!dragId || dragState !== col.state || dragId === t.id) return;
                    // 指针落在目标卡下半 → 插到其后, 上半 → 插到其前; 否则向下拖到相邻卡会原地不动、末位也够不到
                    const rect = e.currentTarget.getBoundingClientRect();
                    const after = e.clientY > rect.top + rect.height / 2;
                    onReorder?.(reorderIds(col.tasks.map((x) => x.id), dragId, t.id, after));
                  }} />
              ))}
          </div>
        </div>
      ))}
    </div>
  );
}
