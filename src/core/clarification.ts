import type { DB } from '../db/connection';
import type { Task } from '../model/types';
import { getTask, updateTask, createTask } from '../repo/tasks';
import { createEdge, edgesFrom, edgesTo } from '../repo/edges';
import { appendEvent } from '../repo/events';
import { canTransition } from './stateMachine';

// 设计决策: 待确认的挂起/解冻也走状态机 canTransition, 六态状态机是状态变更的唯一权威(见 spec §3.2)。待确认仅可从 executing 触发。

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
  if (!canTransition(parent.state, 'awaiting_decision')) {
    throw new Error(`非法状态流转: ${parent.state} → awaiting_decision`);
  }

  const optionsMd = input.options?.length
    ? '\n\n可选项:\n' + input.options.map((o, i) => `- ${String.fromCharCode(65 + i)}. ${o}`).join('\n')
    : '';

  const clarTask = createTask(db, {
    title: `待确认: ${input.question}`,
    parentId: input.parentId,
    state: 'awaiting_decision',
    currentActor: input.toDecider ?? null,
    currentRole: 'decider',
    goal: input.question + optionsMd,
    priority: parent.priority,
  });

  createEdge(db, { fromTask: clarTask.id, toTask: input.parentId, type: 'clarifies' });
  createEdge(db, { fromTask: input.parentId, toTask: clarTask.id, type: 'spawns' });

  const parentUpdated = updateTask(db, input.parentId, { state: 'awaiting_decision' });
  appendEvent(db, {
    taskId: input.parentId, actorId: input.byActor, kind: 'clarify',
    roleFrom: parent.currentRole, roleTo: 'decider', body: input.question,
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
    outputsMd: input.answer, summary: input.answer, state: 'done',
  });
  appendEvent(db, { taskId: input.clarTaskId, actorId: input.byActor, kind: 'decide', body: input.answer });

  // 父任务是否还有其他未决的待确认(取自父的 clarifies 入边)
  const openClar = edgesTo(db, parentId)
    .filter((e) => e.type === 'clarifies')
    .map((e) => getTask(db, e.fromTask))
    .filter((t): t is Task => t !== null && t.state !== 'done');

  let parent = getTask(db, parentId)!;
  if (openClar.length === 0) {
    if (!canTransition(parent.state, 'executing')) {
      throw new Error(`非法状态流转: ${parent.state} → executing`);
    }
    parent = updateTask(db, parentId, { state: 'executing' });
    appendEvent(db, {
      taskId: parentId, actorId: input.byActor, kind: 'decide',
      roleTo: parent.currentRole, body: `已决策 ${input.clarTaskId}: ${input.answer}`,
    });
  } else {
    appendEvent(db, {
      taskId: parentId, actorId: input.byActor, kind: 'decide',
      roleTo: parent.currentRole, body: `已决策 ${input.clarTaskId}: ${input.answer}; 仍有 ${openClar.length} 项待确认`,
    });
  }

  return { clarTask, parent };
}
