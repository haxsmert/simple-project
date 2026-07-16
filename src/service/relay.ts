import type { DB } from '../db/connection';
import type { Actor, ActorType, Task, TaskState, Role, TaskEvent, Edge, EdgeType } from '../model/types';
import { getTask, listChildren, listRoots, createTask, updateTask, type CreateTaskInput, type TaskPatch } from '../repo/tasks';
import { listActors, createActor } from '../repo/actors';
import { assemblePackage, type TaskPackage } from '../core/infoPackage';
import { mirrorTask } from '../mirror/writer';
import { appendEvent } from '../repo/events';
import { handoff, type HandoffInput } from '../core/handoff';
import { raiseClarification, answerClarification, type RaiseInput, type AnswerInput } from '../core/clarification';
import { createEdge, edgesTo } from '../repo/edges';

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

  protected mirrorOne(id: string): void {
    try {
      mirrorTask(this.db, this.mirrorDir, id);
    } catch {
      // 尽力而为: DB 是真相源, 镜像可随时重生成; 落盘失败不得让写操作失败(否则 agent 重试会重复追加事件)
    }
  }

  // 受影响集合 = 任务本身 + 父任务(父的 .md 内嵌子任务状态) + 依赖本任务的任务(它们的 .md 内嵌本任务摘要)
  protected mirror(...ids: Array<string | null | undefined>): void {
    const affected = new Set<string>();
    for (const id of ids) {
      if (!id) continue;
      affected.add(id);
      const t = getTask(this.db, id);
      if (t?.parentId) affected.add(t.parentId);
      for (const e of edgesTo(this.db, id)) if (e.type === 'depends_on') affected.add(e.fromTask);
    }
    for (const id of affected) this.mirrorOne(id);
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
    this.mirror(t.id);
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

  handoff(input: HandoffInput): Task {
    const t = handoff(this.db, input);
    this.mirror(t.id);
    return t;
  }

  raiseClarification(input: RaiseInput): { clarTask: Task; parent: Task } {
    const r = raiseClarification(this.db, input);
    this.mirror(r.parent.id, r.clarTask.id);
    return r;
  }

  answerClarification(input: AnswerInput): { clarTask: Task; parent: Task } {
    const r = answerClarification(this.db, input);
    this.mirror(r.clarTask.id, r.parent.id);
    return r;
  }

  linkEdge(input: { fromTask: string; toTask: string; type: EdgeType }): Edge {
    const e = createEdge(this.db, input);
    this.mirror(input.fromTask, input.toTask);
    return e;
  }
}
