import type { DB } from '../db/connection';
import type { TaskEvent, EventKind, Role, TaskState } from '../model/types';
import { now, uid } from '../util';

interface EventRow {
  id: string; task_id: string; actor_id: string; kind: EventKind;
  role_from: string | null; role_to: string | null;
  to_actor: string | null; state_from: string | null; state_to: string | null;
  body: string | null; created_at: string;
}
const map = (r: EventRow): TaskEvent => ({
  id: r.id, taskId: r.task_id, actorId: r.actor_id, kind: r.kind,
  roleFrom: r.role_from as Role | null, roleTo: r.role_to as Role | null,
  toActor: r.to_actor, stateFrom: r.state_from as TaskState | null, stateTo: r.state_to as TaskState | null,
  body: r.body, createdAt: r.created_at,
});

export function appendEvent(
  db: DB,
  input: {
    taskId: string; actorId: string; kind: EventKind;
    roleFrom?: Role | null; roleTo?: Role | null;
    toActor?: string | null; stateFrom?: TaskState | null; stateTo?: TaskState | null;
    body?: string | null;
  },
): TaskEvent {
  const row: EventRow = {
    id: uid('ev'), task_id: input.taskId, actor_id: input.actorId, kind: input.kind,
    role_from: input.roleFrom ?? null, role_to: input.roleTo ?? null,
    to_actor: input.toActor ?? null, state_from: input.stateFrom ?? null, state_to: input.stateTo ?? null,
    body: input.body ?? null, created_at: now(),
  };
  db.prepare(
    'INSERT INTO events (id,task_id,actor_id,kind,role_from,role_to,to_actor,state_from,state_to,body,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)',
  ).run(row.id, row.task_id, row.actor_id, row.kind, row.role_from, row.role_to, row.to_actor, row.state_from, row.state_to, row.body, row.created_at);
  return map(row);
}

export function listEvents(db: DB, taskId: string): TaskEvent[] {
  return (db.prepare('SELECT * FROM events WHERE task_id=? ORDER BY rowid').all(taskId) as EventRow[]).map(map);
}
