import type { Task, Actor } from '../types';
import { ActorBadge } from './ActorBadge';
import { RoleChip } from './RoleChip';
import { EdgeChip } from './EdgeChip';

export function TaskCard({ task, actor, onOpen }: { task: Task; actor: Actor | null; onOpen: (id: string) => void }) {
  const blocked = task.state === 'awaiting_decision';
  return (
    <div className={`card${blocked ? ' blocked' : ''}`} onClick={() => onOpen(task.id)}>
      <div className="card-top">
        <RoleChip role={task.currentRole} />
        {blocked && <EdgeChip type="clarifies" label="待决策" />}
      </div>
      <p className="card-title">{task.title}</p>
      <div className="card-foot">
        <ActorBadge actor={actor} />
        <span className="card-id">{task.id}</span>
      </div>
    </div>
  );
}
