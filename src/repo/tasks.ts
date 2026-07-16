import type { DB } from '../db/connection';
import type { Task, TaskState, Role, Priority } from '../model/types';
import { now } from '../util';

interface TaskRow {
  id: string; title: string; parent_id: string | null; state: string;
  current_actor: string | null; current_role: string | null;
  goal: string | null; inputs_md: string | null; outputs_md: string | null;
  summary: string | null; priority: string | null; created_at: string; updated_at: string;
}
const map = (r: TaskRow): Task => ({
  id: r.id, title: r.title, parentId: r.parent_id, state: r.state as TaskState,
  currentActor: r.current_actor, currentRole: r.current_role as Role | null,
  goal: r.goal, inputsMd: r.inputs_md, outputsMd: r.outputs_md, summary: r.summary,
  priority: r.priority as Priority | null, createdAt: r.created_at, updatedAt: r.updated_at,
});

export function nextTaskId(db: DB): string {
  const rows = db.prepare("SELECT id FROM tasks WHERE id LIKE 'R-%'").all() as { id: string }[];
  const max = rows.reduce((m, { id }) => {
    const n = parseInt(id.slice(2), 10);
    return Number.isFinite(n) && n > m ? n : m;
  }, 0);
  return `R-${max + 1}`;
}

export interface CreateTaskInput {
  title: string; id?: string; parentId?: string | null; state?: TaskState;
  currentActor?: string | null; currentRole?: Role | null;
  goal?: string | null; inputsMd?: string | null; outputsMd?: string | null;
  summary?: string | null; priority?: Priority | null;
}

export function createTask(db: DB, input: CreateTaskInput): Task {
  const id = input.id ?? nextTaskId(db);
  const ts = now();
  const row: TaskRow = {
    id, title: input.title, parent_id: input.parentId ?? null, state: input.state ?? 'planning',
    current_actor: input.currentActor ?? null, current_role: input.currentRole ?? null,
    goal: input.goal ?? null, inputs_md: input.inputsMd ?? null, outputs_md: input.outputsMd ?? null,
    summary: input.summary ?? null, priority: input.priority ?? null, created_at: ts, updated_at: ts,
  };
  db.prepare(
    `INSERT INTO tasks
       (id,title,parent_id,state,current_actor,current_role,goal,inputs_md,outputs_md,summary,priority,created_at,updated_at)
     VALUES
       (@id,@title,@parent_id,@state,@current_actor,@current_role,@goal,@inputs_md,@outputs_md,@summary,@priority,@created_at,@updated_at)`,
  ).run(row);
  return map(row);
}

export function getTask(db: DB, id: string): Task | null {
  const r = db.prepare('SELECT * FROM tasks WHERE id=?').get(id) as TaskRow | undefined;
  return r ? map(r) : null;
}

export interface TaskPatch {
  title?: string; state?: TaskState; currentActor?: string | null; currentRole?: Role | null;
  goal?: string | null; inputsMd?: string | null; outputsMd?: string | null;
  summary?: string | null; priority?: Priority | null;
}

export function updateTask(db: DB, id: string, patch: TaskPatch): Task {
  if (!getTask(db, id)) throw new Error(`任务不存在: ${id}`);
  const cols: Record<string, keyof TaskPatch> = {
    title: 'title', state: 'state', current_actor: 'currentActor', current_role: 'currentRole',
    goal: 'goal', inputs_md: 'inputsMd', outputs_md: 'outputsMd', summary: 'summary', priority: 'priority',
  };
  const sets: string[] = [];
  const vals: unknown[] = [];
  for (const [col, key] of Object.entries(cols)) {
    if (key in patch) { sets.push(`${col}=?`); vals.push(patch[key] ?? null); }
  }
  sets.push('updated_at=?'); vals.push(now());
  vals.push(id);
  db.prepare(`UPDATE tasks SET ${sets.join(', ')} WHERE id=?`).run(...vals);
  return getTask(db, id)!;
}

export function listChildren(db: DB, parentId: string): Task[] {
  return (db.prepare('SELECT * FROM tasks WHERE parent_id=? ORDER BY CAST(substr(id, 3) AS INTEGER)').all(parentId) as TaskRow[]).map(map);
}

export function listRoots(db: DB): Task[] {
  return (db.prepare('SELECT * FROM tasks WHERE parent_id IS NULL ORDER BY CAST(substr(id, 3) AS INTEGER)').all() as TaskRow[]).map(map);
}

export function ancestors(db: DB, id: string): Task[] {
  const chain: Task[] = [];
  let cur = getTask(db, id);
  while (cur?.parentId) {
    const p = getTask(db, cur.parentId);
    if (!p) break;
    chain.unshift(p);
    cur = p;
  }
  return chain;
}
