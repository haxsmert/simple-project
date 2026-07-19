// 主干四阶段: 计划→执行→测试→完成。挂起(等确认/等决策)不是阶段, 是平行的 Hold 字段 —— 挂起 = 原地举手
export type TaskState = 'planning' | 'executing' | 'testing' | 'done';
export type Hold = 'confirm' | 'decision' | null;
export type Role = 'planner' | 'executor' | 'tester' | 'decider';
export type ActorType = 'human' | 'agent';
export type EdgeType = 'depends_on' | 'clarifies';

export interface Task {
  id: string; title: string; parentId: string | null; state: TaskState; hold: Hold;
  currentActor: string | null; currentRole: Role | null;
  goal: string | null; planMd: string | null; outputsMd: string | null; summary: string | null;
  priority: 'hi' | 'mid' | 'lo' | null;
  rank?: number | null;
}
export interface Actor { id: string; name: string; type: ActorType; }
export interface Edge { id: string; fromTask: string; toTask: string; type: EdgeType; }
// 详情里的关系边带对端标题: 引用不许只给编码("依赖 R-20"没人知道是什么)
export interface EdgeRef extends Edge { peerTitle: string; }
export interface BoardCard extends Task {
  subtaskCount?: number;
  doneSubtaskCount?: number;
  edges?: { out: Edge[]; in: Edge[] };
  parentTitle?: string | null;
  attention?: number;
}
export interface BoardColumn { state: TaskState; tasks: BoardCard[]; }
// 项目层透镜(2026-07-19): 项目卡 = 目标 + 🔔待处理 + 最近动静; 两组 = 执行中/已完结
export interface ProjectActivity {
  kind: string; actorId: string; actorName: string; taskId: string; taskTitle: string;
  toActor: string | null; body: string | null;
  stateFrom: TaskState | null; stateTo: TaskState | null;
  holdFrom: Hold; holdTo: Hold;
  createdAt: string;
}
export interface ProjectCard extends Task { attention: number; lastEvent: ProjectActivity | null; }
export interface ProjectOverview { active: ProjectCard[]; closed: ProjectCard[]; }
export interface TaskEvent {
  id: string; taskId: string; actorId: string; kind: string;
  roleFrom: Role | null; roleTo: Role | null;
  toActor: string | null; stateFrom: TaskState | null; stateTo: TaskState | null;
  holdFrom: Hold; holdTo: Hold;
  body: string | null; createdAt: string;
}
export interface TaskNode extends Task { children: TaskNode[]; }
export interface TaskPackage {
  task: Task; breadcrumb: Task[];
  inputs: { goal: string | null; planMd: string | null; depOutputs: Array<{ taskId: string; title: string; summary: string | null; outputsMd: string | null }> };
  outputs: { outputsMd: string | null; summary: string | null };
  clarifications: Task[]; thread: TaskEvent[]; subtasks: Task[];
  edges: { out: EdgeRef[]; in: EdgeRef[] };
  projectActivity?: ProjectActivity[]; // 仅项目(顶层任务): 全树最近动静(项目自身少有事件, 动静在子孙上)
}
