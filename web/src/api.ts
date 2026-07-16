import type { BoardColumn, TaskNode, TaskPackage, Actor, Task } from './types';

async function j<T>(url: string, opts?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    ...opts,
    headers: opts?.body ? { 'content-type': 'application/json' } : undefined,
  });
  const data = await res.json();
  if (!res.ok) throw new Error((data as { error?: string }).error ?? `HTTP ${res.status}`);
  return data as T;
}
const post = <T>(url: string, body: unknown) => j<T>(url, { method: 'POST', body: JSON.stringify(body) });

export const api = {
  board: () => j<BoardColumn[]>('/api/board'),
  tree: () => j<TaskNode[]>('/api/tree'),
  actors: () => j<Actor[]>('/api/actors'),
  task: (id: string) => j<TaskPackage>(`/api/tasks/${id}`),
  createTask: (body: { title: string; goal?: string; parentId?: string }) => post<Task>('/api/tasks', body),
  handoff: (body: { taskId: string; byActor: string; toActor: string; toRole: string; toState?: string; note?: string }) => post<Task>('/api/handoff', body),
  raise: (body: { parentId: string; byActor: string; question: string; options?: string[]; toDecider?: string }) => post('/api/clarifications', body),
  answer: (id: string, body: { byActor: string; answer: string }) => post(`/api/clarifications/${id}/answer`, body),
};
