import type { DB } from '../db/connection';
import type { Role } from '../model/types';

export const ALL_ROLES: Role[] = ['planner', 'executor', 'tester', 'questioner', 'decider'];

// 默认路由: 某个角色该派给谁。
//
// 为什么是"查出来"而不是"配出来": spec §2 定死「角色不绑死在 Actor 身上 —— 同一 agent 这个任务当执行者、
// 那个任务当测试者」。所以不能给 actor 加一个静态的"你是测试员"字段, 那会把设计约定改掉。
// 规则只能是行为性的: **最近谁在扮演这个角色, 就默认还派给谁**(tasks.current_role + updated_at 可查)。
// 这样系统"学"的是实际发生过的分工, 而不是谁去填了一张表。
//
// 兜底顺序: 最近扮演过该角色的人 → 任意 agent(人类通常是决策者, 不该被默认派去干活) → 任意 actor → null。
export function suggestActorForRole(db: DB, role: Role): string | null {
  const recent = db.prepare(
    `SELECT current_actor FROM tasks
      WHERE current_role = ? AND current_actor IS NOT NULL
      ORDER BY updated_at DESC LIMIT 1`,
  ).get(role) as { current_actor: string } | undefined;
  if (recent) return recent.current_actor;

  // 决策是人的活: 没历史时优先给人, 其余角色优先给 agent
  const type = role === 'decider' ? 'human' : 'agent';
  const byType = db.prepare(`SELECT id FROM actors WHERE type = ? ORDER BY created_at LIMIT 1`).get(type) as { id: string } | undefined;
  if (byType) return byType.id;

  const any = db.prepare(`SELECT id FROM actors ORDER BY created_at LIMIT 1`).get() as { id: string } | undefined;
  return any?.id ?? null;
}

// 全部角色的默认人选 —— 界面据此把"交给谁"预先填好(你仍可手动改), MCP 那边的 agent 也共用同一套规则
export function routingTable(db: DB): Record<Role, string | null> {
  return Object.fromEntries(ALL_ROLES.map((r) => [r, suggestActorForRole(db, r)])) as Record<Role, string | null>;
}
