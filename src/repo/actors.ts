import type { DB } from '../db/connection';
import type { Actor, ActorType } from '../model/types';
import { now } from '../util';

interface ActorRow {
  id: string; name: string; type: ActorType; created_at: string;
}
const map = (r: ActorRow): Actor => ({
  id: r.id, name: r.name, type: r.type, createdAt: r.created_at,
});

export function createActor(
  db: DB,
  input: { id: string; name: string; type: ActorType },
): Actor {
  const row: ActorRow = {
    id: input.id, name: input.name, type: input.type,
    created_at: now(),
  };
  db.prepare('INSERT INTO actors (id,name,type,created_at) VALUES (?,?,?,?)')
    .run(row.id, row.name, row.type, row.created_at);
  return map(row);
}

export function getActor(db: DB, id: string): Actor | null {
  const r = db.prepare('SELECT * FROM actors WHERE id=?').get(id) as ActorRow | undefined;
  return r ? map(r) : null;
}

export function listActors(db: DB, type?: ActorType): Actor[] {
  const rows = (type
    ? db.prepare('SELECT * FROM actors WHERE type=? ORDER BY id').all(type)
    : db.prepare('SELECT * FROM actors ORDER BY id').all()) as ActorRow[];
  return rows.map(map);
}
