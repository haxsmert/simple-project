import { describe, it, expect } from 'vitest';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDb } from '../src/db/connection';
import { seed, runSeedCli } from '../src/seed';
import { getTask } from '../src/repo/tasks';
import { suggestWithBasis } from '../src/core/routing';
import type { TaskState } from '../src/model/types';

const ALL_STATES: TaskState[] = ['planning', 'awaiting_confirm', 'executing', 'awaiting_decision', 'testing', 'done'];

describe('seed 端到端', () => {
  it('铺出 Relay 场景, 触发待确认挂起, 镜像等量文件', () => {
    const db = openDb(':memory:');
    const dir = mkdtempSync(join(tmpdir(), 'relay-seed-'));
    const res = seed(db, dir);

    expect(res.taskCount).toBeGreaterThanOrEqual(6);
    expect(res.files.length).toBe(res.taskCount);
    // R-7 因执行者(执行·B)提问而被挂起为待决策
    expect(getTask(db, 'R-7')!.state).toBe('awaiting_decision');
    // 镜像文件真的写出来了
    expect(readFileSync(join(dir, 'R-7.md'), 'utf8')).toContain('# 导出任务为 Markdown 报告');
  });

  // demo 数据不是随便塞几条 —— 它得把产品讲清楚。这条守住那几个叙事支点, 免得日后改 seed 时悄悄弄丢。
  it('demo 数据讲得出产品: 六态齐全 / 两种"轮到你"各一个 / 角色分工真实发生过', () => {
    const db = openDb(':memory:');
    seed(db, mkdtempSync(join(tmpdir(), 'relay-seed2-')));

    const states = (db.prepare('SELECT state, COUNT(*) c FROM tasks GROUP BY state').all() as { state: string; c: number }[]);
    const byState = Object.fromEntries(states.map((s) => [s.state, s.c]));
    for (const s of ALL_STATES) expect(byState[s], `${s} 列是空的, 看板会开天窗`).toBeGreaterThan(0);

    // 两个人类关卡各一个 → 顶栏"待你处理"演示得出 2
    expect(byState.awaiting_confirm).toBe(1); // 计划等你拍板
    // 提问会产生两条待决策: 被挂起的父任务 + 新生的那张"问题卡"(它自己也是任务)。
    // 看板只列一层, 所以人看到的是 1 —— 这里查的是裸表, 2 才是对的。
    expect(byState.awaiting_decision).toBe(2);
    const depth1Decisions = (db.prepare(
      "SELECT COUNT(*) c FROM tasks WHERE state='awaiting_decision' AND parent_id IN (SELECT id FROM tasks WHERE parent_id IS NULL)",
    ).get() as { c: number }).c;
    expect(depth1Decisions, '看板"待决策"列应恰好 1 条').toBe(1);

    // 默认路由是行为性推断的: 这几个角色必须真有人扮演过, 否则只能兜底瞎猜, 规则等于没有
    for (const role of ['planner', 'executor', 'tester', 'decider'] as const) {
      expect(suggestWithBasis(db, role).basis, `${role} 没有真实分工历史 → 默认路由只能瞎猜`).toBe('history');
    }
    expect(suggestWithBasis(db, 'planner').actorId).toBe('agent-plan-p'); // 演示"交给规划 agent"
    expect(suggestWithBasis(db, 'tester').actorId).toBe('agent-test-t');  // 演示"交去测试"派给测试者

    // 换手事件记全"谁交给了谁/状态怎么变" —— 否则「经过」只会吐"交给了下一个人"
    const h = db.prepare("SELECT to_actor, state_from, state_to FROM events WHERE kind='handoff'").all() as { to_actor: string | null; state_from: string | null; state_to: string | null }[];
    expect(h.length).toBeGreaterThan(0);
    expect(h.every((e) => e.to_actor && e.state_from && e.state_to)).toBe(true);
  });

  it('runSeedCli 可重复运行(重置后再 seed 不撞主键)', () => {
    const base = mkdtempSync(join(tmpdir(), 'relay-cli-'));
    const dbPath = join(base, 'relay.db');
    const dir = join(base, 'tasks');
    const first = runSeedCli(dbPath, dir);
    const second = runSeedCli(dbPath, dir); // 第二次不应抛
    expect(second.taskCount).toBe(first.taskCount);
    expect(second.files.length).toBe(second.taskCount);
  });
});
