import type { DB } from '../db/connection';
import type { Task } from '../model/types';
import { getTask, updateTask, createTask } from '../repo/tasks';
import { createEdge } from '../repo/edges';
import { appendEvent } from '../repo/events';

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

  const edge = db.prepare(
    "SELECT to_task FROM edges WHERE from_task=? AND type='clarifies'",
  ).get(input.clarTaskId) as { to_task: string } | undefined;
  if (!edge) throw new Error(`该任务不是待确认任务: ${input.clarTaskId}`);

  const clarTask = updateTask(db, input.clarTaskId, {
    outputsMd: input.answer, summary: input.answer, state: 'done',
  });
  appendEvent(db, { taskId: input.clarTaskId, actorId: input.byActor, kind: 'decide', body: input.answer });

  const parent = updateTask(db, edge.to_task, { state: 'executing' });
  appendEvent(db, {
    taskId: edge.to_task, actorId: input.byActor, kind: 'decide',
    roleTo: parent.currentRole, body: `已决策 ${input.clarTaskId}: ${input.answer}`,
  });

  return { clarTask, parent };
}
