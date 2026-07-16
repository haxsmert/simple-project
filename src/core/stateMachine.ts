import type { TaskState, Role } from '../model/types';

export const TRANSITIONS: Record<TaskState, TaskState[]> = {
  planning: ['awaiting_confirm', 'executing'],
  awaiting_confirm: ['executing', 'planning'],
  executing: ['awaiting_decision', 'testing'],
  awaiting_decision: ['executing'],
  testing: ['done', 'executing'],
  done: [],
};

export function canTransition(from: TaskState, to: TaskState): boolean {
  return from === to || TRANSITIONS[from].includes(to);
}

const DEFAULT_NEXT: Record<TaskState, { state: TaskState; role: Role } | null> = {
  planning: { state: 'awaiting_confirm', role: 'decider' },
  awaiting_confirm: { state: 'executing', role: 'executor' },
  executing: { state: 'testing', role: 'tester' },
  awaiting_decision: { state: 'executing', role: 'executor' },
  testing: { state: 'done', role: 'tester' },
  done: null,
};

export function defaultNext(state: TaskState): { state: TaskState; role: Role } | null {
  return DEFAULT_NEXT[state];
}
