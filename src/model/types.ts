export type ActorType = 'human' | 'agent';
export type Role = 'planner' | 'executor' | 'tester' | 'questioner' | 'decider';
export type TaskState =
  | 'planning' | 'awaiting_confirm' | 'executing'
  | 'awaiting_decision' | 'testing' | 'done';
export type EdgeType = 'blocks' | 'depends_on' | 'clarifies' | 'spawns';
export type EventKind = 'handoff' | 'comment' | 'output' | 'clarify' | 'decide' | 'claim';
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
  body: string | null;
  createdAt: string;
}
