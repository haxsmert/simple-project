export type ActorType = 'human' | 'agent';
// 角色 = 此刻在任务上扮演什么。「提问」是动作(raise_clarification), 不是常驻角色 —— questioner 已删
export type Role = 'planner' | 'executor' | 'tester' | 'decider';
// 主干四阶段: 计划 → 执行 → 测试 → 完成。挂起(待确认/待决策)不是阶段, 是平行的 Hold 字段。
export type TaskState = 'planning' | 'executing' | 'testing' | 'done';
// 关系边只留两种说得清的: depends_on(A 依赖 B 的产出) / clarifies(问题卡 → 所属任务)。
// blocks 与 depends_on 互为反向(同一关系两个名字)、spawns 是 clarifies 的反向冗余 —— 均已删
export type EdgeType = 'depends_on' | 'clarifies';
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
  planMd: string | null;   // 计划(规划的交付物, 执行的输入)
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
