import type { DB } from '../db/connection';
import type { TaskEvent, EventKind, Role } from '../model/types';
import { now, uid } from '../util';

interface EventRow {
  id: string; task_id: string; actor_id: string; kind: EventKind;
  role_from: string | null; role_to: string | null; body: string | null; created_at: string;
}
const map = (r: EventRow): TaskEvent => ({
  id: r.id, taskId: r.task_id, actorId: r.actor_id, kind: r.kind,
  roleFrom: r.role_from as Role | null, roleTo: r.role_to as Role | null,
  body: r.body, createdAt: r.created_at,
});

export function appendEvent(
  db: DB,
  input: {
    taskId: string; actorId: string; kind: EventKind;
    roleFrom?: Role | null; roleTo?: Role | null; body?: string | null;
  },
): TaskEvent {
  const row: EventRow = {
    id: uid('ev'), task_id: input.taskId, actor_id: input.actorId, kind: input.kind,
    role_from: input.roleFrom ?? null, role_to: input.roleTo ?? null,
    body: input.body ?? null, created_at: now(),
  };
  db.prepare(
    'INSERT INTO events (id,task_id,actor_id,kind,role_from,role_to,body,created_at) VALUES (?,?,?,?,?,?,?,?)',
  ).run(row.id, row.task_id, row.actor_id, row.kind, row.role_from, row.role_to, row.body, row.created_at);
  return map(row);
}

export function listEvents(db: DB, taskId: string): TaskEvent[] {
  return (db.prepare('SELECT * FROM events WHERE task_id=? ORDER BY rowid').all(taskId) as EventRow[]).map(map);
}
