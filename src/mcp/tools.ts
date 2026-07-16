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
