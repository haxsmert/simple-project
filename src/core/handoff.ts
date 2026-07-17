import type { DB } from '../db/connection';
import type { Task, Role, TaskState } from '../model/types';
import { getTask, updateTask } from '../repo/tasks';
import { appendEvent } from '../repo/events';
import { canTransition } from './stateMachine';

export interface HandoffInput {
  taskId: string;
  byActor: string;
  toActor: string;
  toRole: Role;
  toState?: TaskState;
  note?: string;
}

export function handoff(db: DB, input: HandoffInput): Task {
  const task = getTask(db, input.taskId);
  if (!task) throw new Error(`任务不存在: ${input.taskId}`);
  const toState = input.toState ?? task.state;
  if (!canTransition(task.state, toState)) {
    throw new Error(`非法状态流转: ${task.state} → ${toState}`);
  }
  // 产品约定(2026-07-17): 主干是 计划→执行→测试→完成, 待确认/待决策是跳出的关卡。
  // 确认关可以跳过, 但"有计划"不能跳过 —— 计划是执行的输入, 从待规划往前推进(无论去执行还是去确认)必须先有计划。
  if (task.state === 'planning' && toState !== 'planning' && !(task.inputsMd ?? '').trim()) {
    throw new Error('还没有计划: 先写计划(界面的计划输入 / MCP submit_plan)再推进');
  }
  const fromRole = task.currentRole;
  const fromState = task.state;
  const updated = updateTask(db, input.taskId, {
    currentActor: input.toActor, currentRole: input.toRole, state: toState,
  });
  // 记全"谁交给了谁 / 状态怎么变的" —— 少了这些, 历史只能说"交给了下一个人"这种废话
  appendEvent(db, {
    taskId: input.taskId, actorId: input.byActor, kind: 'handoff',
    roleFrom: fromRole, roleTo: input.toRole,
    toActor: input.toActor, stateFrom: fromState, stateTo: toState,
    body: input.note ?? null,
  });
  return updated;
}
