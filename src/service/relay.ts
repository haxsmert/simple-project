import type { DB } from '../db/connection';
import type { Actor, ActorType, Task, TaskState, Role, TaskEvent, Edge, EdgeType, Priority } from '../model/types';
import { getTask, listChildren, listRoots, createTask, updateTask, removeTask, setRank, type CreateTaskInput, type TaskPatch } from '../repo/tasks';
import { listActors, createActor } from '../repo/actors';
import { assemblePackage, type TaskPackage } from '../core/infoPackage';
import { mirrorTask } from '../mirror/writer';
import { rmSync } from 'node:fs';
import { join } from 'node:path';
import { appendEvent } from '../repo/events';
import { handoff, type HandoffInput } from '../core/handoff';
import { raiseClarification, answerClarification, type RaiseInput, type AnswerInput } from '../core/clarification';
import { createEdge, edgesFrom, edgesTo } from '../repo/edges';
import { routingTable, type ActorSuggestion } from '../core/routing';

// 主干四阶段即看板四列; 挂起(hold)不是列 —— 挂起的任务留在自己的阶段列里"原地举手"(卡片上亮挂起标)
export const STATE_ORDER: TaskState[] = ['planning', 'executing', 'testing', 'done'];

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

  // 默认路由表: 每个角色默认派给谁(最近扮演过该角色的人)。界面用它把"交给谁"预填好, 不必每次手选。
  routing(): Record<Role, ActorSuggestion> {
    return routingTable(this.db);
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

  // 任务列表 → 按主干四阶段分组的富化看板列(board/projectBoard/taskBoard 共用分组逻辑)
  // 列是队列, **位置即优先级**(越靠前越优先, 用户约定 2026-07-17): 手动排过的(rank)最优先服从人的排列;
  // 没排过的按 priority 权重落位(hi>mid>lo), 同权重按 id —— 默认顺序从第一天就讲得通, 不需要"高/中/低"文字标签
  private groupByState(tasks: Task[]): Array<{ state: TaskState; tasks: BoardCard[] }> {
    const byIdNum = (id: string) => parseInt(id.slice(2), 10);
    const prioW = (p: Task['priority']) => (p === 'hi' ? 0 : p === 'mid' ? 1 : p === 'lo' ? 2 : 3);
    return STATE_ORDER.map((state) => ({
      state,
      tasks: tasks
        .filter((t) => t.state === state)
        .sort((a, b) =>
          (a.rank ?? Infinity) - (b.rank ?? Infinity)
          || prioW(a.priority) - prioW(b.priority)
          || byIdNum(a.id) - byIdNum(b.id))
        .map((t) => this.enrich(t)),
    }));
  }

  board(): Array<{ state: TaskState; tasks: BoardCard[] }> {
    const all = (this.db.prepare('SELECT id FROM tasks').all() as { id: string }[])
      .map((r) => getTask(this.db, r.id))
      .filter((t): t is Task => t !== null);
    return this.groupByState(all);
  }

  // 项目「直接任务(depth-1)」里"轮到你处理"的数量 = 挂起中的任务数(等确认 + 等决策)。
  // 刻意只数一层: 正是该项目任务看板上亮着挂起标、你会点开去处理的卡, 数字与看板一致、可对账。
  // (更深的执行子任务是 agent 领地, 由其父任务的挂起体现, 不重复计数。)
  private pendingAttention(rootId: string): number {
    return listChildren(this.db, rootId).filter((t) => t.hold !== null).length;
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

  // 全局任务过滤 —— 轮询式协作的"发现面": agent 定期来找活, 不能只看"已分给我的"(list_my_tasks),
  // 还要能发现"没人认领的 / 某阶段的 / 挂起中的"任务, 否则"领取任务"无从谈起(只能瞎猜 id)。
  listTasks(filter?: { state?: TaskState; hold?: 'confirm' | 'decision' | 'none' | 'any'; unassigned?: boolean }): Task[] {
    let all = (this.db.prepare('SELECT id FROM tasks').all() as { id: string }[])
      .map((r) => getTask(this.db, r.id))
      .filter((t): t is Task => t !== null);
    if (filter?.state) all = all.filter((t) => t.state === filter.state);
    if (filter?.hold === 'any') all = all.filter((t) => t.hold !== null);
    else if (filter?.hold === 'none') all = all.filter((t) => t.hold === null);
    else if (filter?.hold) all = all.filter((t) => t.hold === filter.hold);
    if (filter?.unassigned) all = all.filter((t) => !t.currentActor);
    return all;
  }

  // "轮到某人处理"的结构化清单 —— IM 集成(飞书/Hermes 机器人)的关键接口:
  // 推送卡片需要"问题文本 + 结构化选项 + 上下文", 不能让集成方自己扒看板逐任务拼。
  // confirms = 等他拍板的任务(附计划全文); decisions = 等他答复的问题卡(附问题/选项/所属任务)。
  pendingFor(actorId: string): {
    confirms: Array<{ task: Task; plan: string | null }>;
    decisions: Array<{ question: Task; questionText: string; options: Array<{ key: string; text: string }>; parent: Task | null }>;
  } {
    const mine = this.listByActor(actorId);
    const confirms = mine.filter((t) => t.hold === 'confirm').map((t) => ({ task: t, plan: t.planMd }));
    const decisions = mine
      .filter((t) => t.hold === 'decision' && t.state !== 'done')
      .flatMap((q) => {
        const clarEdge = edgesFrom(this.db, q.id).find((e) => e.type === 'clarifies');
        if (!clarEdge) return []; // 非问题卡(被挂起的父任务, 决策者不是它的 currentActor)不进清单
        const options: Array<{ key: string; text: string }> = [];
        for (const raw of (q.goal ?? '').split('\n')) {
          const m = /^- ([A-Z])\.\s*(.*)$/.exec(raw.trim());
          if (m) options.push({ key: m[1], text: m[2] });
        }
        return [{
          question: q,
          questionText: q.title.replace(/^待确认:\s*/, ''),
          options,
          parent: getTask(this.db, clarEdge.toTask),
        }];
      });
    return { confirms, decisions };
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
    const before = getTask(this.db, taskId);
    if (!before) throw new Error(`任务不存在: ${taskId}`);
    // 挂起中的任务不是"可领取的活"(它在等确认/等决策): 自助领取会把锁连人抢走, 造出矛盾位。
    // 换人要走 handoff 改派(有角色守卫), 解锁要走 批准/打回/答复。
    if (before.hold !== null) {
      throw new Error(`任务挂起中(${before.hold === 'confirm' ? '等确认' : '等决策'}), 不可领取: 等它解除, 或走 handoff 改派`);
    }
    const patch: TaskPatch = { currentActor: actorId };
    if (role) patch.currentRole = role;
    const t = updateTask(this.db, taskId, patch);
    appendEvent(this.db, { taskId, actorId, kind: 'claim', roleTo: role ?? null });
    this.mirror(taskId);
    return t;
  }

  // 任务信息更新(标题/目标/优先级): 建错了要能改 —— 且改动记进「经过」(实质变更不许静默)
  updateTaskInfo(taskId: string, byActor: string, patch: { title?: string; goal?: string | null; priority?: Priority | null }): Task {
    const before = getTask(this.db, taskId);
    if (!before) throw new Error(`任务不存在: ${taskId}`);
    const changed: string[] = [];
    const p: TaskPatch = {};
    if (patch.title !== undefined && patch.title !== before.title) { p.title = patch.title; changed.push(`标题: ${before.title} → ${patch.title}`); }
    if (patch.goal !== undefined && patch.goal !== before.goal) { p.goal = patch.goal; changed.push('目标'); }
    if (patch.priority !== undefined && patch.priority !== before.priority) { p.priority = patch.priority; changed.push('优先级'); }
    if (changed.length === 0) return before;
    const t = updateTask(this.db, taskId, p);
    appendEvent(this.db, { taskId, actorId: byActor, kind: 'update', body: `更新了 ${changed.join('; ')}` });
    this.mirror(taskId);
    return t;
  }

  // 硬删任务(个人工具的取舍: 不做"取消态", 建错/提错就删)。级联语义:
  // · 有子任务不许删(先移走或删子) —— 防一把删掉整棵树
  // · 边与事件级联清理; 镜像 .md 一并移除(尽力而为)
  // · 未决的问题卡被删 = 撤回提问: 重算父任务挂起(否则父永远卡在"等一个不存在的答复"上)
  deleteTask(taskId: string, byActor: string): { ok: true; unfrozeParent: string | null } {
    const t = getTask(this.db, taskId);
    if (!t) throw new Error(`任务不存在: ${taskId}`);
    const children = listChildren(this.db, taskId);
    if (children.length > 0) throw new Error(`还有 ${children.length} 个子任务, 先移走或删除它们再删本任务`);
    const clarEdge = edgesFrom(this.db, taskId).find((e) => e.type === 'clarifies');
    const parentId = clarEdge?.toTask ?? null;
    let unfrozeParent: string | null = null;
    this.db.transaction(() => {
      this.db.prepare('DELETE FROM events WHERE task_id=?').run(taskId);
      this.db.prepare('DELETE FROM edges WHERE from_task=? OR to_task=?').run(taskId, taskId);
      removeTask(this.db, taskId);
      if (parentId && t.state !== 'done') {
        // 撤回提问: 若父没有其余未决问题卡, 解除挂起(原地继续)
        const stillOpen = edgesTo(this.db, parentId)
          .filter((e) => e.type === 'clarifies')
          .map((e) => getTask(this.db, e.fromTask))
          .filter((q): q is Task => q !== null && q.state !== 'done');
        const parent = getTask(this.db, parentId);
        if (parent && parent.hold === 'decision' && stillOpen.length === 0) {
          updateTask(this.db, parentId, { hold: null });
          appendEvent(this.db, {
            taskId: parentId, actorId: byActor, kind: 'comment',
            stateFrom: parent.state, stateTo: parent.state, holdFrom: 'decision', holdTo: null,
            body: `撤回了提问「${t.title.replace(/^待确认:\s*/, '')}」, 解除挂起`,
          });
          unfrozeParent = parentId;
        }
      }
    })();
    try { rmSync(join(this.mirrorDir, `${taskId}.md`), { force: true }); } catch { /* 镜像尽力而为 */ }
    this.mirror(t.parentId, parentId); // 父的 .md 里嵌着子任务清单, 重生成
    return { ok: true, unfrozeParent };
  }

  // 计划是规划者的交付物, 落在 planMd(它是下一棒执行的输入)。
  // 没有这个通道, "提交计划"就是一句空话 —— 界面和 agent 都无处把计划写进来。
  submitPlan(taskId: string, byActor: string, planMd: string): Task {
    const t = updateTask(this.db, taskId, { planMd: planMd });
    appendEvent(this.db, { taskId, actorId: byActor, kind: 'plan' });
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
