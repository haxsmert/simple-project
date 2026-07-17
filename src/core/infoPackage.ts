import type { DB } from '../db/connection';
import type { Task, Edge, TaskEvent } from '../model/types';
import { getTask, listChildren, ancestors } from '../repo/tasks';
import { edgesFrom, edgesTo } from '../repo/edges';
import { listEvents } from '../repo/events';

export interface DepOutput {
  taskId: string;
  title: string;
  summary: string | null;
  outputsMd: string | null;
}

// 关系边带上对端任务标题: 界面上的引用不能只给编码 —— "依赖 R-20"没人知道是什么,
// 必须"标题 + 编码"同示(编码保留, 但不许独自出场)
export type EdgeRef = Edge & { peerTitle: string };

export interface TaskPackage {
  task: Task;
  breadcrumb: Task[];
  inputs: { goal: string | null; inputsMd: string | null; depOutputs: DepOutput[] };
  outputs: { outputsMd: string | null; summary: string | null };
  clarifications: Task[];
  thread: TaskEvent[];
  subtasks: Task[];
  edges: { out: EdgeRef[]; in: EdgeRef[] };
}

export function assemblePackage(db: DB, id: string): TaskPackage {
  const task = getTask(db, id);
  if (!task) throw new Error(`任务不存在: ${id}`);

  const out = edgesFrom(db, id);
  const incoming = edgesTo(db, id);

  const depOutputs: DepOutput[] = out
    .filter((e) => e.type === 'depends_on')
    .map((e) => {
      const dep = getTask(db, e.toTask);
      return {
        taskId: e.toTask,
        title: dep?.title ?? e.toTask,
        summary: dep?.summary ?? null,
        outputsMd: dep?.outputsMd ?? null,
      };
    });

  const clarifications = incoming
    .filter((e) => e.type === 'clarifies')
    .map((e) => getTask(db, e.fromTask))
    .filter((t): t is Task => t !== null);

  // 对端标题: out 边的对端是 toTask, in 边的对端是 fromTask; 对端不存在时退回编码(不编造)
  const ref = (e: Edge, peer: string): EdgeRef => ({ ...e, peerTitle: getTask(db, peer)?.title ?? peer });

  return {
    task,
    breadcrumb: ancestors(db, id),
    inputs: { goal: task.goal, inputsMd: task.inputsMd, depOutputs },
    outputs: { outputsMd: task.outputsMd, summary: task.summary },
    clarifications,
    thread: listEvents(db, id),
    subtasks: listChildren(db, id),
    edges: { out: out.map((e) => ref(e, e.toTask)), in: incoming.map((e) => ref(e, e.fromTask)) },
  };
}
