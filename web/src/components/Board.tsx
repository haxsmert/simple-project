import type { ReactNode } from 'react';
import type { BoardColumn, TaskState, Actor } from '../types';
import { TaskCard } from './TaskCard';

const NAME: Record<TaskState, string> = { planning: '待规划', awaiting_confirm: '待确认', executing: '执行中', awaiting_decision: '待决策', testing: '测试中', done: '完成' };
const STRIPE: Record<TaskState, string> = { planning: 'var(--text-faint)', awaiting_confirm: '#8b7bd8', executing: 'var(--human)', awaiting_decision: 'var(--warn)', testing: '#37a6b3', done: 'var(--done)' };

export function Board({ columns, actorsById, onOpen, emptyHint }: {
  columns: BoardColumn[]; actorsById: Record<string, Actor>; onOpen: (id: string) => void; emptyHint?: ReactNode;
}) {
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
          <div className="cards">
            {col.tasks.length === 0
              ? <div className="col-empty">暂无</div>
              : col.tasks.map((t) => (
                <TaskCard key={t.id} task={t} actor={t.currentActor ? actorsById[t.currentActor] ?? null : null} onOpen={onOpen} />
              ))}
          </div>
        </div>
      ))}
    </div>
  );
}
