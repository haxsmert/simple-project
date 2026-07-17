import type { DB } from '../db/connection';
import type { Actor, ActorType, Task, TaskState, Role, TaskEvent, Edge, EdgeType } from '../model/types';
import { getTask, listChildren, listRoots, createTask, updateTask, setRank, type CreateTaskInput, type TaskPatch } from '../repo/tasks';
import { listActors, createActor } from '../repo/actors';
import { assemblePackage, type TaskPackage } from '../core/infoPackage';
import { mirrorTask } from '../mirror/writer';
import { appendEvent } from '../repo/events';
import { handoff, type HandoffInput } from '../core/handoff';
import { raiseClarification, answerClarification, type RaiseInput, type AnswerInput } from '../core/clarification';
import { createEdge, edgesFrom, edgesTo } from '../repo/edges';

export const STATE_ORDER: TaskState[] = [
  'planning', 'awaiting_confirm', 'executing', 'awaiting_decision', 'testing', 'done',
];

export interface TaskNode extends Task {
  children: TaskNode[];
}

export interface BoardCard extends Task {
  subtaskCount: number;
  doneSubtaskCount: number;
  edges: { out: Edge[]; in: Edge[] };
  parentTitle: string | null;
  attention?: number;
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
    const affected = new Set<string>(ids.filter((x): x is string => !!x));
    try {
      // 扩展受影响集合的读操作也纳入尽力而为: 计算失败绝不能让已提交的写操作失败(否则 agent 重试会重复追加事件)
      for (const id of [...affected]) {
        const t = getTask(this.db, id);
        if (t?.parentId) affected.add(t.parentId);
        for (const e of edgesTo(this.db, id)) if (e.type === 'depends_on') affected.add(e.fromTask);
      }
    } catch {
      // 扩展失败则退回到只镜像直接传入的任务
    }
    for (const id of affected) this.mirrorOne(id);
  }

  getPackage(id: string): TaskPackage {
    return assemblePackage(this.db, id);
  }

  listActors(type?: ActorType): Actor[] {
    return listActors(this.db, type);
  }

  // 单任务 → BoardCard: 补子任务计数 + 关系边(board/projectBoard/taskBoard 共用富化逻辑)
  private enrich(t: Task): BoardCard {
    const children = listChildren(this.db, t.id);
    return {
      ...t,
      subtaskCount: children.length,
      doneSubtaskCount: children.filter((c) => c.state === 'done').length,
      edges: { out: edgesFrom(this.db, t.id), in: edgesTo(this.db, t.id) },
      parentTitle: t.parentId ? (getTask(this.db, t.parentId)?.title ?? null) : null,
    };
  }

  // 任务列表 → 按六态分组的富化看板列(board/projectBoard/taskBoard 共用分组逻辑)
  // 同状态列内按 rank 升序排列, rank 为 null 的任务排最后(按数字 id 排序), 保持既有 id 顺序直到列被显式重排
  private groupByState(tasks: Task[]): Array<{ state: TaskState; tasks: BoardCard[] }> {
    const byIdNum = (id: string) => parseInt(id.slice(2), 10);
    return STATE_ORDER.map((state) => ({
      state,
      tasks: tasks
        .filter((t) => t.state === state)
        .sort((a, b) => (a.rank ?? Infinity) - (b.rank ?? Infinity) || byIdNum(a.id) - byIdNum(b.id))
        .map((t) => this.enrich(t)),
    }));
  }

  board(): Array<{ state: TaskState; tasks: BoardCard[] }> {
    const all = (this.db.prepare('SELECT id FROM tasks').all() as { id: string }[])
      .map((r) => getTask(this.db, r.id))
      .filter((t): t is Task => t !== null);
    return this.groupByState(all);
  }

  // 项目「直接任务(depth-1)」里"轮到你处理"的数量 —— 两个人类关卡: 待确认(确认计划)+ 待决策(答复澄清)。
  // 刻意只数一层: 正是该项目任务看板「待确认」「待决策」两列里你会点开去处理的卡, 数字与看板一致、可对账。
  // (更深的执行子任务是 agent 领地, 由其父任务的状态体现, 不重复计数。)
  private pendingAttention(rootId: string): number {
    return listChildren(this.db, rootId).filter(
      (t) => t.state === 'awaiting_confirm' || t.state === 'awaiting_decision',
    ).length;
  }

  // 项目 = 顶层任务(parentId null); 项目卡额外带 attention(直接任务里"待你处理"的数量, 人类最高价值信号)
  projectBoard(): Array<{ state: TaskState; tasks: BoardCard[] }> {
    const grouped = this.groupByState(listRoots(this.db));
    for (const col of grouped) {
      for (const card of col.tasks) card.attention = this.pendingAttention(card.id);
    }
    return grouped;
  }

  // 任务 = 项目的直接子任务
  taskBoard(projectId: string): Array<{ state: TaskState; tasks: BoardCard[] }> {
    return this.groupByState(listChildren(this.db, projectId));
  }

  // 全部项目的一层任务: 跨所有项目聚合直接子任务(depth 1), 供任务看板"全部项目"筛选; 不含项目本身与更深的执行子任务
  allTasksBoard(): Array<{ state: TaskState; tasks: BoardCard[] }> {
    const tasks = listRoots(this.db).flatMap((project) => listChildren(this.db, project.id));
    return this.groupByState(tasks);
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

  // 列内拖拽重排: 按给定顺序把 rank 赋为 0,1,2,... (同一状态列内的顺序即持久化顺序)
  reorder(ids: string[]): void {
    this.db.transaction(() => { ids.forEach((id, i) => setRank(this.db, id, i)); })();
  }
}
