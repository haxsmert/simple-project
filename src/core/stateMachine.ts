import type { TaskState, Hold, Role } from '../model/types';

// 模型(2026-07-17 用户定调): 主干四阶段 计划→执行→测试→完成 是一条线;
// 挂起(hold)是与主干**平行**的中断字段, 不是阶段 —— 挂起 = 原地举手, 解除 = 原地继续或前进。
// 除「完成」外任何阶段都可能被中断, 且可中断多次。

// 主干推进边(hold 为空时可走的阶段流转): 前进一步 + 测试打回返工
export const STAGE_EDGES: Record<TaskState, TaskState[]> = {
  planning: ['executing'],
  executing: ['testing'],
  testing: ['executing', 'done'],
  done: [],
};

// "往前走一步"到哪(批准确认时前进的那一步)
export const NEXT_STAGE: Partial<Record<TaskState, TaskState>> = {
  planning: 'executing', executing: 'testing', testing: 'done',
};

export interface Position { state: TaskState; hold: Hold; }

// 位置变更规则表 —— 状态变更唯一权威(spec §3.2):
// · 原地(同阶段同挂起): 允许 —— 纯改派
// · decision 挂起的设/解不走这里(clarification 模块专管: 提问挂起 / 全部答复解除), 一律拒
// · null→confirm: 同阶段提交把关(完成态无下一步, 不可挂)
// · confirm→null: 批准(前进一步)或打回(留在原阶段)
// · null→null: 走主干推进边
export function canMove(from: Position, to: Position): boolean {
  if (from.state === to.state && from.hold === to.hold) return true;
  if (from.hold === 'decision' || to.hold === 'decision') return false;
  if (from.hold === null && to.hold === 'confirm') {
    return to.state === from.state && from.state !== 'done';
  }
  if (from.hold === 'confirm' && to.hold === null) {
    return to.state === NEXT_STAGE[from.state] || to.state === from.state;
  }
  // 主干推进只在**双方挂起均为空**时合法 —— 少了这个限定, "confirm 保持不动 + 阶段前进"
  // 会从这里漏过去, 造出"执行中却还挂着等确认"的矛盾位(实锤: 前端丢 toHold 时批准被误放行)
  return from.hold === null && to.hold === null && STAGE_EDGES[from.state].includes(to.state);
}

const DEFAULT_NEXT: Record<TaskState, { state: TaskState; role: Role } | null> = {
  planning: { state: 'executing', role: 'executor' },
  executing: { state: 'testing', role: 'tester' },
  testing: { state: 'done', role: 'tester' },
  done: null,
};

export function defaultNext(state: TaskState): { state: TaskState; role: Role } | null {
  return DEFAULT_NEXT[state];
}
