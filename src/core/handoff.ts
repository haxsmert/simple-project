import type { DB } from '../db/connection';
import type { Task, Role, TaskState, Hold } from '../model/types';
import { getTask, updateTask, listChildren } from '../repo/tasks';
import { appendEvent, listEvents } from '../repo/events';
import { canMove } from './stateMachine';

export interface HandoffInput {
  taskId: string;
  byActor: string;
  toActor: string;
  toRole: Role;
  toState?: TaskState; // 缺省 = 阶段不动
  toHold?: Hold;       // 缺省 = 挂起不动(改派挂起中的任务不解除挂起); 显式 null = 解除确认挂起
  note?: string;
}

export function handoff(db: DB, input: HandoffInput): Task {
  const task = getTask(db, input.taskId);
  if (!task) throw new Error(`任务不存在: ${input.taskId}`);
  const toState = input.toState ?? task.state;
  const toHold = input.toHold === undefined ? task.hold : input.toHold;
  if (!canMove({ state: task.state, hold: task.hold }, { state: toState, hold: toHold })) {
    throw new Error(`非法流转: ${task.state}${task.hold ? `(${task.hold})` : ''} → ${toState}${toHold ? `(${toHold})` : ''}`);
  }
  // 产品约定(2026-07-17): 确认关可以跳过, 但计划不能跳过 —— 计划是执行的输入,
  // 从计划阶段推进(直接开工, 或提交等确认)都必须先有计划。
  const advancing = task.state === 'planning' && task.hold === null && (toState !== 'planning' || toHold === 'confirm');
  if (advancing && !(task.inputsMd ?? '').trim()) {
    throw new Error('还没有计划: 先写计划(界面的计划输入 / MCP submit_plan)再推进');
  }
  // 原地改派保角色(2026-07-17 实洞): 位置不动(阶段、挂起都不变)的换手 = 纯换人,
  // 不许顺带改角色 —— 否则能把"等确认"连锁转给 planner, 造出"任务在规划者手里却还挂着等确认"的矛盾位。
  // 角色变更只随位置变更发生(提交=转决策者 / 批准=转执行者 / …)。
  if (toState === task.state && toHold === task.hold && input.toRole !== task.currentRole) {
    throw new Error(`原地改派不改变角色(当前 ${task.currentRole ?? '无'}): 要换角色请随流程推进(批准/打回/提交等确认)`);
  }
  // 自批闸(机制层, MCP 也拦): 确认的批准人不能是提交这份确认的人 —— 界面的 toHuman 只是呈现层,
  // 这里才是真闸。提交时不许交给自己; 确认挂起中改派也不许转回提交人。
  if (toHold === 'confirm') {
    const submitter = task.hold === 'confirm'
      ? [...listEvents(db, input.taskId)].reverse().find((e) => e.holdTo === 'confirm' && e.holdFrom !== 'confirm')?.actorId ?? null
      : input.byActor; // 本次就是提交动作
    if (submitter && input.toActor === submitter) {
      throw new Error('提交确认的人不能当自己这份计划/产出的批准人: 交给别的决策者');
    }
  }
  // 父子最小不变量(2026-07-17 用户拍板方案 B): 完成的任务不能有没完成的子 ——
  // 进「完成」前直接子任务必须全完成(硬闸只设这一条; 进测试时子未完不拦, 界面如实提示)
  if (toState === 'done' && task.state !== 'done') {
    const open = listChildren(db, task.id).filter((c) => c.state !== 'done');
    if (open.length > 0) {
      throw new Error(`还有 ${open.length} 个子任务未完成(${open.slice(0, 3).map((c) => c.id).join(', ')}${open.length > 3 ? '…' : ''}): 子任务全部完成才能标记完成`);
    }
  }
  const fromRole = task.currentRole;
  const fromState = task.state;
  const fromHold = task.hold;
  const updated = updateTask(db, input.taskId, {
    currentActor: input.toActor, currentRole: input.toRole, state: toState, hold: toHold,
  });
  // 记全"谁交给了谁 / 阶段与挂起怎么变的" —— 少了这些, 历史只能说"交给了下一个人"这种废话
  appendEvent(db, {
    taskId: input.taskId, actorId: input.byActor, kind: 'handoff',
    roleFrom: fromRole, roleTo: input.toRole,
    toActor: input.toActor, stateFrom: fromState, stateTo: toState,
    holdFrom: fromHold, holdTo: toHold,
    body: input.note ?? null,
  });
  return updated;
}
