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

const stateEnum = z.enum(['planning', 'awaiting_confirm', 'executing', 'awaiting_decision', 'testing', 'done']);

export const handoffTool = {
  name: 'handoff',
  description: '把任务换手给另一个行动者/角色(经状态机校验)',
  schema: {
    task_id: z.string(), by_actor: z.string(), to_actor: z.string(),
    to_role: roleEnum, to_state: stateEnum.optional(), note: z.string().optional(),
  },
  handler(service: RelayService, args: {
    task_id: string; by_actor: string; to_actor: string;
    to_role: z.infer<typeof roleEnum>; to_state?: z.infer<typeof stateEnum>; note?: string;
  }): ToolResult {
    return ok(service.handoff({
      taskId: args.task_id, byActor: args.by_actor, toActor: args.to_actor,
      toRole: args.to_role, toState: args.to_state, note: args.note,
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
  listMyTasksTool, getTaskTool, claimTool, handoffTool,
  submitPlanTool, submitOutputTool, raiseClarificationTool, answerClarificationTool, commentTool,
];
