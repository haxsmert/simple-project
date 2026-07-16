import type { DB } from '../db/connection';
import type { Actor, ActorType, Task, TaskState, Role } from '../model/types';
import { getTask, listChildren, listRoots } from '../repo/tasks';
import { listActors } from '../repo/actors';
import { assemblePackage, type TaskPackage } from '../core/infoPackage';
import { mirrorTask } from '../mirror/writer';
import { createActor } from '../repo/actors';
import { createTask, updateTask, type CreateTaskInput, type TaskPatch } from '../repo/tasks';
import { appendEvent } from '../repo/events';
import type { TaskEvent } from '../model/types';

export const STATE_ORDER: TaskState[] = [
  'planning', 'awaiting_confirm', 'executing', 'awaiting_decision', 'testing', 'done',
];

export interface TaskNode extends Task {
  children: TaskNode[];
}

export class RelayService {
  constructor(
    private readonly db: DB,
    private readonly mirrorDir: string,
  ) {}

  protected mirror(...ids: Array<string | null | undefined>): void {
    for (const id of ids) if (id) mirrorTask(this.db, this.mirrorDir, id);
  }

  getPackage(id: string): TaskPackage {
    return assemblePackage(this.db, id);
  }

  listActors(type?: ActorType): Actor[] {
    return listActors(this.db, type);
  }

  board(): Array<{ state: TaskState; tasks: Task[] }> {
    const all = (this.db.prepare('SELECT id FROM tasks').all() as { id: string }[])
      .map((r) => getTask(this.db, r.id))
      .filter((t): t is Task => t !== null);
    return STATE_ORDER.map((state) => ({ state, tasks: all.filter((t) => t.state === state) }));
  }

  tree(): TaskNode[] {
    const build = (t: Task): TaskNode => ({
      ...t,
      children: listChildren(this.db, t.id).map(build),
    });
    return listRoots(this.db).map(build);
  }

  listByActor(actorId: string, role?: Role): Task[] {
    const all = (this.db.prepare('SELECT id FROM tasks WHERE current_actor=?').all(actorId) as { id: string }[])
      .map((r) => getTask(this.db, r.id))
      .filter((t): t is Task => t !== null);
    return role ? all.filter((t) => t.currentRole === role) : all;
  }

  registerActor(input: { id: string; name: string; type: ActorType; handle?: string | null }): Actor {
    return createActor(this.db, input);
  }

  createTask(input: CreateTaskInput): Task {
    const t = createTask(this.db, input);
    this.mirror(t.id, t.parentId);
    return t;
  }

  claim(taskId: string, actorId: string, role?: Role): Task {
    const patch: TaskPatch = { currentActor: actorId };
    if (role) patch.currentRole = role;
    const t = updateTask(this.db, taskId, patch);
    appendEvent(this.db, { taskId, actorId, kind: 'claim', roleTo: role ?? null });
    this.mirror(taskId);
    return t;
  }

  submitOutput(
    taskId: string,
    byActor: string,
    out: { outputsMd?: string | null; summary?: string | null },
  ): Task {
    const patch: TaskPatch = {};
    if (out.outputsMd !== undefined) patch.outputsMd = out.outputsMd;
    if (out.summary !== undefined) patch.summary = out.summary;
    const t = updateTask(this.db, taskId, patch);
    appendEvent(this.db, { taskId, actorId: byActor, kind: 'output', body: out.summary ?? null });
    this.mirror(taskId);
    return t;
  }

  comment(taskId: string, actorId: string, body: string): TaskEvent {
    const ev = appendEvent(this.db, { taskId, actorId, kind: 'comment', body });
    this.mirror(taskId);
    return ev;
  }
}
