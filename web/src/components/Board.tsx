import type { BoardColumn, TaskState, Actor } from '../types';
import { TaskCard } from './TaskCard';

const NAME: Record<TaskState, string> = { planning: '待规划', awaiting_confirm: '待确认', executing: '执行中', awaiting_decision: '待决策', testing: '测试中', done: '完成' };
const STRIPE: Record<TaskState, string> = { planning: 'var(--text-faint)', awaiting_confirm: '#8b7bd8', executing: 'var(--human)', awaiting_decision: 'var(--warn)', testing: '#37a6b3', done: 'var(--done)' };

export function Board({ columns, actorsById, onOpen }: {
  columns: BoardColumn[]; actorsById: Record<string, Actor>; onOpen: (id: string) => void;
}) {
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
            {col.tasks.map((t) => (
              <TaskCard key={t.id} task={t} actor={t.currentActor ? actorsById[t.currentActor] ?? null : null} onOpen={onOpen} />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
