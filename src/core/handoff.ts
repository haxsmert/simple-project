import type { DB } from '../db/connection';
import type { Task, Role, TaskState, Hold } from '../model/types';
import { getTask, updateTask } from '../repo/tasks';
import { appendEvent } from '../repo/events';
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
