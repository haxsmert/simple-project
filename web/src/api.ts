import type { BoardColumn, TaskNode, TaskPackage, Actor, Task, ProjectOverview } from './types';

// 带状态码的错误: 401(未登录)要走登录页分流, 不能和业务错误(400 守卫拦下)混成一条横幅
export class ApiError extends Error {
  constructor(message: string, public status: number) { super(message); }
}

async function j<T>(url: string, opts?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    ...opts,
    headers: opts?.body ? { 'content-type': 'application/json' } : undefined,
  });
  const data = await res.json();
  if (!res.ok) throw new ApiError((data as { error?: string }).error ?? `HTTP ${res.status}`, res.status);
  return data as T;
}
const post = <T>(url: string, body: unknown) => j<T>(url, { method: 'POST', body: JSON.stringify(body) });

export const api = {
  projects: () => j<ProjectOverview>('/api/projects'),
  taskBoard: (id: string) => j<BoardColumn[]>(`/api/projects/${id}/board`),
  allTasks: () => j<BoardColumn[]>('/api/tasks-board'),
  tree: () => j<TaskNode[]>('/api/tree'),
  actors: () => j<Actor[]>('/api/actors'),
  routing: () => j<Record<string, { actorId: string | null; basis: 'history' | 'fallback' }>>('/api/routing'),
  task: (id: string) => j<TaskPackage>(`/api/tasks/${id}`),
  createTask: (body: { title: string; goal?: string; parentId?: string }) => post<Task>('/api/tasks', body),
  handoff: (body: { taskId: string; byActor: string; toActor: string; toRole: string; toState?: string; toHold?: string | null; note?: string }) => post<Task>('/api/handoff', body),
  plan: (id: string, body: { byActor: string; planMd: string }) => post<Task>(`/api/tasks/${id}/plan`, body),
  output: (id: string, body: { byActor: string; outputsMd?: string; summary?: string }) => post<Task>(`/api/tasks/${id}/output`, body),
  answer: (id: string, body: { byActor: string; answer: string }) => post(`/api/clarifications/${id}/answer`, body),
  comment: (id: string, body: { actor: string; body: string }) => post(`/api/tasks/${id}/comment`, body),
  updateTask: (id: string, body: { byActor: string; title?: string; goal?: string }) =>
    j<Task>(`/api/tasks/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
  deleteTask: (id: string, byActor: string) =>
    j<{ ok: boolean }>(`/api/tasks/${id}?byActor=${encodeURIComponent(byActor)}`, { method: 'DELETE' }),
  reorder: (ids: string[]) => post<{ ok: boolean }>('/api/reorder', { ids }),
  login: (user: string, pass: string) => post<{ ok: boolean }>('/api/login', { user, pass }),
  logout: () => post<{ ok: boolean }>('/api/logout', {}),
};
