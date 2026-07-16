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
  const fromRole = task.currentRole;
  const updated = updateTask(db, input.taskId, {
    currentActor: input.toActor, currentRole: input.toRole, state: toState,
  });
  appendEvent(db, {
    taskId: input.taskId, actorId: input.byActor, kind: 'handoff',
    roleFrom: fromRole, roleTo: input.toRole, body: input.note ?? null,
  });
  return updated;
}
