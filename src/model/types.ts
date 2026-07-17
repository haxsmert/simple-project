export type ActorType = 'human' | 'agent';
export type Role = 'planner' | 'executor' | 'tester' | 'questioner' | 'decider';
// 主干四阶段: 计划 → 执行 → 测试 → 完成。挂起(待确认/待决策)不是阶段, 是平行的 Hold 字段。
export type TaskState = 'planning' | 'executing' | 'testing' | 'done';
export type EdgeType = 'blocks' | 'depends_on' | 'clarifies' | 'spawns';
export type EventKind = 'handoff' | 'comment' | 'output' | 'clarify' | 'decide' | 'claim' | 'plan' | 'update';

// 挂起(2026-07-17 用户定的模型): 与主干阶段**平行**的另一个字段, 类似"锁定/中断"。
// 任务永远处在主干某一站(state), 挂起是原地举手, 不是搬到另一站; 除「完成」外任何阶段
// 都可能被中断、可中断多次。confirm=产出已提交等批准前进一步; decision=卡住提问等答复后原地继续。
export type Hold = 'confirm' | 'decision' | null;
export type Priority = 'hi' | 'mid' | 'lo';

export interface Actor {
  id: string;
  name: string;
  type: ActorType;
  handle: string | null;
  createdAt: string;
}

export interface Task {
  id: string;
  title: string;
  parentId: string | null;
  state: TaskState;
  hold: Hold;                    // 挂起标志: 与 state 正交(confirm=等批准前进 / decision=等答复原地继续)
  currentActor: string | null;
  currentRole: Role | null;
  goal: string | null;
  inputsMd: string | null;
  outputsMd: string | null;
  summary: string | null;
  priority: Priority | null;
  rank: number | null;
  createdAt: string;
  updatedAt: string;
}

export interface Edge {
  id: string;
  fromTask: string;
  toTask: string;
  type: EdgeType;
  createdAt: string;
}

export interface TaskEvent {
  id: string;
  taskId: string;
  actorId: string;
  kind: EventKind;
  roleFrom: Role | null;
  roleTo: Role | null;
  toActor: string | null;        // 交给了谁 —— actorId 只是"谁发起的"
  stateFrom: TaskState | null;   // 阶段怎么变的
  stateTo: TaskState | null;
  holdFrom: Hold;                // 挂起怎么变的(提交等确认/批准/打回 的证据)
  holdTo: Hold;
  body: string | null;
  createdAt: string;
}
