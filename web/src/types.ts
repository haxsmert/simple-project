export type TaskState = 'planning' | 'awaiting_confirm' | 'executing' | 'awaiting_decision' | 'testing' | 'done';
export type Role = 'planner' | 'executor' | 'tester' | 'questioner' | 'decider';
export type ActorType = 'human' | 'agent';
export type EdgeType = 'blocks' | 'depends_on' | 'clarifies' | 'spawns';

export interface Task {
  id: string; title: string; parentId: string | null; state: TaskState;
  currentActor: string | null; currentRole: Role | null;
  goal: string | null; inputsMd: string | null; outputsMd: string | null; summary: string | null;
  priority: 'hi' | 'mid' | 'lo' | null;
  rank?: number | null;
}
export interface Actor { id: string; name: string; type: ActorType; handle: string | null; }
export interface Edge { id: string; fromTask: string; toTask: string; type: EdgeType; }
export interface BoardCard extends Task {
  subtaskCount?: number;
  doneSubtaskCount?: number;
  edges?: { out: Edge[]; in: Edge[] };
}
export interface BoardColumn { state: TaskState; tasks: BoardCard[]; }
export interface TaskEvent { id: string; taskId: string; actorId: string; kind: string; roleFrom: Role | null; roleTo: Role | null; body: string | null; createdAt: string; }
export interface TaskNode extends Task { children: TaskNode[]; }
export interface TaskPackage {
  task: Task; breadcrumb: Task[];
  inputs: { goal: string | null; inputsMd: string | null; depOutputs: Array<{ taskId: string; title: string; summary: string | null; outputsMd: string | null }> };
  outputs: { outputsMd: string | null; summary: string | null };
  clarifications: Task[]; thread: TaskEvent[]; subtasks: Task[];
  edges: { out: Edge[]; in: Edge[] };
}
