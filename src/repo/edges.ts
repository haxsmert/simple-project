import type { DB } from '../db/connection';
import type { Edge, EdgeType } from '../model/types';
import { now, uid } from '../util';

interface EdgeRow {
  id: string; from_task: string; to_task: string; type: EdgeType; created_at: string;
}
const map = (r: EdgeRow): Edge => ({
  id: r.id, fromTask: r.from_task, toTask: r.to_task, type: r.type, createdAt: r.created_at,
});

export function createEdge(
  db: DB,
  input: { fromTask: string; toTask: string; type: EdgeType },
): Edge {
  const row: EdgeRow = {
    id: uid('e'), from_task: input.fromTask, to_task: input.toTask,
    type: input.type, created_at: now(),
  };
  db.prepare('INSERT INTO edges (id,from_task,to_task,type,created_at) VALUES (?,?,?,?,?)')
    .run(row.id, row.from_task, row.to_task, row.type, row.created_at);
  return map(row);
}

export function edgesFrom(db: DB, taskId: string): Edge[] {
  return (db.prepare('SELECT * FROM edges WHERE from_task=? ORDER BY rowid').all(taskId) as EdgeRow[]).map(map);
}

export function edgesTo(db: DB, taskId: string): Edge[] {
  return (db.prepare('SELECT * FROM edges WHERE to_task=? ORDER BY rowid').all(taskId) as EdgeRow[]).map(map);
}
