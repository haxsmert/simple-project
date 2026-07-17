import { z } from 'zod';
import type { RelayService } from '../service/relay';

export interface ToolResult {
  content: Array<{ type: 'text'; text: string }>;
}

export function ok(data: unknown): ToolResult {
  return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
}

const roleEnum = z.enum(['planner', 'executor', 'tester', 'questioner', 'decider']);

export const listMyTasksTool = {
  name: 'list_my_tasks',
  description: '列出某个行动者(你或某 agent)当前手上的任务, 可按角色过滤',
  schema: { actor: z.string(), role: roleEnum.optional() },
  handler(service: RelayService, args: { actor: string; role?: z.infer<typeof roleEnum> }): ToolResult {
    return ok(service.listByActor(args.actor, args.role));
  },
};

const prioEnum = z.enum(['hi', 'mid', 'lo']);

export const createTaskTool = {
  name: 'create_task',
  description: '创建任务(默认生在计划阶段)。parent_id 指定父任务即建子任务; actor/role 指定初始负责人。',
  schema: {
    title: z.string(), parent_id: z.string().optional(), goal: z.string().optional(),
    priority: prioEnum.optional(), actor: z.string().optional(), role: roleEnum.optional(),
  },
  handler(service: RelayService, args: { title: string; parent_id?: string; goal?: string; priority?: 'hi' | 'mid' | 'lo'; actor?: string; role?: z.infer<typeof roleEnum> }): ToolResult {
    return ok(service.createTask({
      title: args.title, parentId: args.parent_id, goal: args.goal,
      priority: args.priority, currentActor: args.actor, currentRole: args.role,
    }));
  },
};

export const updateTaskTool = {
  name: 'update_task',
  description: '更新任务信息(标题/目标/优先级 —— 建错了要能改)。改动会记进任务的「经过」。状态/挂起/负责人不走这里(用 handoff/claim)。',
  schema: { task_id: z.string(), by_actor: z.string(), title: z.string().optional(), goal: z.string().optional(), priority: prioEnum.optional() },
  handler(service: RelayService, args: { task_id: string; by_actor: string; title?: string; goal?: string; priority?: 'hi' | 'mid' | 'lo' }): ToolResult {
    return ok(service.updateTaskInfo(args.task_id, args.by_actor, { title: args.title, goal: args.goal, priority: args.priority }));
  },
};

export const deleteTaskTool = {
  name: 'delete_task',
  description:
    '删除任务(硬删, 连同它的关系边/历史/镜像文件)。有子任务的不许删(先移走或删子)。' +
    '删除未答复的问题卡 = 撤回提问: 父任务若无其余未决问题会自动解除挂起。',
  schema: { task_id: z.string(), by_actor: z.string() },
  handler(service: RelayService, args: { task_id: string; by_actor: string }): ToolResult {
    return ok(service.deleteTask(args.task_id, args.by_actor));
  },
};

export const linkEdgeTool = {
  name: 'link_edge',
  description: '建任务间的有向关系边: blocks(阻塞)/depends_on(依赖)/clarifies(待确认)/spawns(引出)。',
  schema: { from_task: z.string(), to_task: z.string(), type: z.enum(['blocks', 'depends_on', 'clarifies', 'spawns']) },
  handler(service: RelayService, args: { from_task: string; to_task: string; type: 'blocks' | 'depends_on' | 'clarifies' | 'spawns' }): ToolResult {
    return ok(service.linkEdge({ fromTask: args.from_task, toTask: args.to_task, type: args.type }));
  },
};

export const registerActorTool = {
  name: 'register_actor',
  description: '注册行动者(人或 agent)。新 agent 接入时先自报家门, 之后才能领任务/被指派。',
  schema: { id: z.string(), name: z.string(), type: z.enum(['human', 'agent']), handle: z.string().optional() },
  handler(service: RelayService, args: { id: string; name: string; type: 'human' | 'agent'; handle?: string }): ToolResult {
    return ok(service.registerActor(args));
  },
};

export const listActorsTool = {
  name: 'list_actors',
  description: '列出全部行动者(handoff/claim 的 to_actor 从这里选, 不用靠外部告知)。可按 type=human|agent 过滤。',
  schema: { type: z.enum(['human', 'agent']).optional() },
  handler(service: RelayService, args: { type?: 'human' | 'agent' }): ToolResult {
    return ok(service.listActors(args.type));
  },
};

export const listTasksTool = {
  name: 'list_tasks',
  description:
    '按条件发现任务(找活的入口): state=主干阶段过滤; hold=挂起过滤(confirm/decision/none/any); ' +
    'unassigned=true 只列没人认领的(可用 claim 领取)。不带条件则列全部。',
  schema: {
    state: z.enum(['planning', 'executing', 'testing', 'done']).optional(),
    hold: z.enum(['confirm', 'decision', 'none', 'any']).optional(),
    unassigned: z.boolean().optional(),
  },
  handler(service: RelayService, args: { state?: 'planning' | 'executing' | 'testing' | 'done'; hold?: 'confirm' | 'decision' | 'none' | 'any'; unassigned?: boolean }): ToolResult {
    return ok(service.listTasks(args));
  },
};

export const listPendingTool = {
  name: 'list_pending',
  description:
    '列出"轮到某人处理"的结构化清单: confirms=等他拍板的任务(附计划全文), ' +
    'decisions=等他答复的问题卡(附问题文本/结构化选项/所属任务)。答复用 answer_clarification, 批准/打回用 handoff。',
  schema: { actor: z.string() },
  handler(service: RelayService, args: { actor: string }): ToolResult {
    return ok(service.pendingFor(args.actor));
  },
};

export const getTaskTool = {
  name: 'get_task',
  description: '取某个任务的完整信息包(输入/产出/待确认/交互记录/子任务/关系边)',
  schema: { id: z.string() },
  handler(service: RelayService, args: { id: string }): ToolResult {
    return ok(service.getPackage(args.id));
  },
};

export const claimTool = {
  name: 'claim',
  description: '领取一个任务(设为当前负责人, 可指定角色)',
  schema: { task_id: z.string(), actor: z.string(), role: roleEnum.optional() },
  handler(service: RelayService, args: { task_id: string; actor: string; role?: z.infer<typeof roleEnum> }): ToolResult {
    return ok(service.claim(args.task_id, args.actor, args.role));
  },
};

// 主干四阶段; 挂起(等确认/等决策)是平行字段 to_hold, 不是阶段
const stateEnum = z.enum(['planning', 'executing', 'testing', 'done']);
const holdEnum = z.enum(['confirm', 'none']);

export const handoffTool = {
  name: 'handoff',
  description:
    '把任务换手给另一个行动者/角色(经状态机校验)。to_state=主干阶段(计划/执行/测试/完成); ' +
    'to_hold=挂起变更: "confirm"=提交本阶段产出等决策者批准(批准后 to_state 前进一步), "none"=解除确认挂起(批准或打回), ' +
    '缺省=挂起不动。等决策(decision)挂起由 raise/answer_clarification 专管, 不走本工具。',
  schema: {
    task_id: z.string(), by_actor: z.string(), to_actor: z.string(),
    to_role: roleEnum, to_state: stateEnum.optional(), to_hold: holdEnum.optional(), note: z.string().optional(),
  },
  handler(service: RelayService, args: {
    task_id: string; by_actor: string; to_actor: string;
    to_role: z.infer<typeof roleEnum>; to_state?: z.infer<typeof stateEnum>;
    to_hold?: z.infer<typeof holdEnum>; note?: string;
  }): ToolResult {
    return ok(service.handoff({
      taskId: args.task_id, byActor: args.by_actor, toActor: args.to_actor,
      toRole: args.to_role, toState: args.to_state,
      toHold: args.to_hold === undefined ? undefined : (args.to_hold === 'none' ? null : args.to_hold),
      note: args.note,
    }));
  },
};

export const submitPlanTool = {
  name: 'submit_plan',
  description: '写入/更新任务计划(Markdown, 落在「任务内容」作为执行的输入; 「- [ ] 事项」行会按清单展示)',
  schema: { task_id: z.string(), by_actor: z.string(), plan_md: z.string() },
  handler(service: RelayService, args: { task_id: string; by_actor: string; plan_md: string }): ToolResult {
    return ok(service.submitPlan(args.task_id, args.by_actor, args.plan_md));
  },
};

export const submitOutputTool = {
  name: 'submit_output',
  description: '提交任务产出(产物 Markdown / 一句话摘要)',
  schema: { task_id: z.string(), by_actor: z.string(), outputs_md: z.string().optional(), summary: z.string().optional() },
  handler(service: RelayService, args: { task_id: string; by_actor: string; outputs_md?: string; summary?: string }): ToolResult {
    return ok(service.submitOutput(args.task_id, args.by_actor, { outputsMd: args.outputs_md, summary: args.summary }));
  },
};

export const raiseClarificationTool = {
  name: 'raise_clarification',
  description: '遇到不清楚的问题, 触发阻塞式待确认(挂起当前任务, 交给决策者)',
  schema: {
    parent_id: z.string(), by_actor: z.string(), question: z.string(),
    options: z.array(z.string()).optional(), to_decider: z.string().optional(),
  },
  handler(service: RelayService, args: {
    parent_id: string; by_actor: string; question: string; options?: string[]; to_decider?: string;
  }): ToolResult {
    return ok(service.raiseClarification({
      parentId: args.parent_id, byActor: args.by_actor, question: args.question,
      options: args.options, toDecider: args.to_decider,
    }));
  },
};

export const answerClarificationTool = {
  name: 'answer_clarification',
  description: '答复一个待确认(写回答案, 全部答复后父任务解冻续跑)',
  schema: { clar_task_id: z.string(), by_actor: z.string(), answer: z.string() },
  handler(service: RelayService, args: { clar_task_id: string; by_actor: string; answer: string }): ToolResult {
    return ok(service.answerClarification({ clarTaskId: args.clar_task_id, byActor: args.by_actor, answer: args.answer }));
  },
};

export const commentTool = {
  name: 'comment',
  description: '在任务的交互记录里追加一条评论',
  schema: { task_id: z.string(), actor: z.string(), body: z.string() },
  handler(service: RelayService, args: { task_id: string; actor: string; body: string }): ToolResult {
    return ok(service.comment(args.task_id, args.actor, args.body));
  },
};

export const ALL_TOOLS = [
  listMyTasksTool, listTasksTool, listPendingTool, getTaskTool,
  createTaskTool, updateTaskTool, deleteTaskTool, linkEdgeTool,
  registerActorTool, listActorsTool,
  claimTool, handoffTool, submitPlanTool, submitOutputTool,
  raiseClarificationTool, answerClarificationTool, commentTool,
];
