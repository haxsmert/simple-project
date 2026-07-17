import type { DB } from '../db/connection';
import type { Role } from '../model/types';

export const ALL_ROLES: Role[] = ['planner', 'executor', 'tester', 'decider'];

// 默认路由: 某个角色该派给谁。
//
// 为什么是"查出来"而不是"配出来": spec §2 定死「角色不绑死在 Actor 身上 —— 同一 agent 这个任务当执行者、
// 那个任务当测试者」。所以不能给 actor 加一个静态的"你是测试员"字段, 那会把设计约定改掉。
// 规则只能是行为性的: **最近谁在扮演这个角色, 就默认还派给谁**(tasks.current_role + updated_at 可查)。
// 这样系统"学"的是实际发生过的分工, 而不是谁去填了一张表。
//
// 兜底顺序: 最近扮演过该角色的人 → 任意 agent(人类通常是决策者, 不该被默认派去干活) → 任意 actor → null。
// 返回值带 basis: 'history' = 真按最近分工推出的; 'fallback' = 没人扮演过这个角色, 这是猜的。
// 冷启动是行为性推断的固有短板(spec §2 禁止给 actor 打静态角色标签, 所以无从"配置"),
// 与其用兜底掩盖成"看起来有规则", 不如把"这是猜的"如实说出来, 让界面能提示、让人顺手改。
export type ActorSuggestion = { actorId: string | null; basis: 'history' | 'fallback' };

export function suggestWithBasis(db: DB, role: Role): ActorSuggestion {
  const recent = db.prepare(
    `SELECT current_actor FROM tasks
      WHERE current_role = ? AND current_actor IS NOT NULL
      ORDER BY updated_at DESC, rowid DESC LIMIT 1`,
  ).get(role) as { current_actor: string } | undefined;
  if (recent) return { actorId: recent.current_actor, basis: 'history' };

  const type = role === 'decider' ? 'human' : 'agent';
  const byType = db.prepare(`SELECT id FROM actors WHERE type = ? ORDER BY created_at LIMIT 1`).get(type) as { id: string } | undefined;
  const any = byType ?? (db.prepare(`SELECT id FROM actors ORDER BY created_at LIMIT 1`).get() as { id: string } | undefined);
  return { actorId: any?.id ?? null, basis: 'fallback' };
}

export function suggestActorForRole(db: DB, role: Role): string | null {
  return suggestWithBasis(db, role).actorId;
}

// 全部角色的默认人选 + 依据 —— 界面据此把"交给谁"预填好, 并在 basis='fallback' 时提示"这是猜的"。
// 注: 目前只有 Web UI 用它预填; MCP 的 handoff 工具仍要求 agent 自己指定 to_actor, 并未共用这套路由。
export function routingTable(db: DB): Record<Role, ActorSuggestion> {
  return Object.fromEntries(ALL_ROLES.map((r) => [r, suggestWithBasis(db, r)])) as Record<Role, ActorSuggestion>;
}
