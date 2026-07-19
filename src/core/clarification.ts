import type { DB } from '../db/connection';
import type { Task } from '../model/types';
import { getTask, updateTask, createTask } from '../repo/tasks';
import { getActor } from '../repo/actors';
import { createEdge, edgesFrom, edgesTo } from '../repo/edges';
import { appendEvent } from '../repo/events';

// 设计决策(2026-07-17 模型): 提问挂起是与主干平行的 hold='decision', 不是阶段 ——
// 除「完成」外**任何阶段**都能提问中断(计划想不清/执行卡住/测试有歧义), 且可多次;
// 全部答复后清 hold, 任务**原地继续**(在哪站挂起就回哪站, 不再假设"回执行中")。
// decision 的设/解只走本模块, handoff 不得碰(canMove 里一律拒), 保住"问题挂着任务不能跑"的不变量。

export interface RaiseInput {
  parentId: string;
  byActor: string;
  question: string;
  options?: string[];
  toDecider?: string;
}

export function raiseClarification(
  db: DB,
  input: RaiseInput,
): { clarTask: Task; parent: Task } {
  const parent = getTask(db, input.parentId);
  if (!parent) throw new Error(`任务不存在: ${input.parentId}`);
  for (const a of [input.byActor, input.toDecider].filter((x): x is string => !!x)) {
    if (!getActor(db, a)) throw new Error(`行动者不存在: ${a}(先注册: register_actor / POST /api/actors)`);
  }
  if (parent.state === 'done') throw new Error('已完成的任务没有可提问的下一步');
  // 项目不挂起(2026-07-19 定调): 提问挂起是任务层节奏 —— 对着项目提问会把长期方向整个锁死
  if (parent.parentId === null) throw new Error('项目不挂起: 把问题提在具体任务上(或在项目里留言)');
  // decision 挂起中允许追加提问(并发多问, 全答完才解冻); confirm 挂起要先批准/打回, 两种挂起不叠加
  if (parent.hold === 'confirm') throw new Error('任务挂在等确认上, 先批准或打回再提问');

  const optionsMd = input.options?.length
    ? '\n\n可选项:\n' + input.options.map((o, i) => `- ${String.fromCharCode(65 + i)}. ${o}`).join('\n')
    : '';

  // 问题卡本身也是任务: 不走主干, 生在计划站并直接挂 decision, 答复即完成
  const clarTask = createTask(db, {
    title: `待确认: ${input.question}`,
    parentId: input.parentId,
    state: 'planning',
    hold: 'decision',
    currentActor: input.toDecider ?? null,
    currentRole: 'decider',
    goal: input.question + optionsMd,
    priority: parent.priority,
  });

  createEdge(db, { fromTask: clarTask.id, toTask: input.parentId, type: 'clarifies' }); // 反向不再冗余存 spawns 边(查询取入边即可)

  const parentUpdated = updateTask(db, input.parentId, { hold: 'decision' }); // 阶段不动, 原地举手
  appendEvent(db, {
    taskId: input.parentId, actorId: input.byActor, kind: 'clarify',
    roleFrom: parent.currentRole, roleTo: 'decider',
    stateFrom: parent.state, stateTo: parent.state, holdFrom: parent.hold, holdTo: 'decision',
    body: input.question,
  });

  return { clarTask, parent: parentUpdated };
}

export interface AnswerInput {
  clarTaskId: string;
  byActor: string;
  answer: string;
}

export function answerClarification(
  db: DB,
  input: AnswerInput,
): { clarTask: Task; parent: Task } {
  const clar = getTask(db, input.clarTaskId);
  if (!clar) throw new Error(`待确认任务不存在: ${input.clarTaskId}`);
  if (clar.state === 'done') throw new Error(`待确认已决策, 勿重复: ${input.clarTaskId}`);

  const edge = edgesFrom(db, input.clarTaskId).find((e) => e.type === 'clarifies');
  if (!edge) throw new Error(`该任务不是待确认任务: ${input.clarTaskId}`);
  const parentId = edge.toTask;

  const clarTask = updateTask(db, input.clarTaskId, {
    outputsMd: input.answer, summary: input.answer, state: 'done', hold: null,
  });
  appendEvent(db, { taskId: input.clarTaskId, actorId: input.byActor, kind: 'decide', body: input.answer });

  // 父任务是否还有其他未决的待确认(取自父的 clarifies 入边)
  const openClar = edgesTo(db, parentId)
    .filter((e) => e.type === 'clarifies')
    .map((e) => getTask(db, e.fromTask))
    .filter((t): t is Task => t !== null && t.state !== 'done');

  let parent = getTask(db, parentId)!;
  if (openClar.length === 0) {
    parent = updateTask(db, parentId, { hold: null }); // 全部答复 → 解除挂起, 原地继续
    appendEvent(db, {
      taskId: parentId, actorId: input.byActor, kind: 'decide',
      roleTo: parent.currentRole,
      stateFrom: parent.state, stateTo: parent.state, holdFrom: 'decision', holdTo: null,
      body: `已决策 ${input.clarTaskId}: ${input.answer}`,
    });
  } else {
    appendEvent(db, {
      taskId: parentId, actorId: input.byActor, kind: 'decide',
      roleTo: parent.currentRole,
      body: `已决策 ${input.clarTaskId}: ${input.answer}; 仍有 ${openClar.length} 项待确认`,
    });
  }

  return { clarTask, parent };
}
