import { describe, it, expect } from 'vitest';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDb } from '../src/db/connection';
import { seed, runSeedCli } from '../src/seed';
import { getTask } from '../src/repo/tasks';
import { suggestWithBasis } from '../src/core/routing';
import type { TaskState } from '../src/model/types';

const ALL_STATES: TaskState[] = ['planning', 'executing', 'testing', 'done'];

describe('seed 端到端', () => {
  it('铺出 Relay 场景, 触发待确认挂起, 镜像等量文件', () => {
    const db = openDb(':memory:');
    const dir = mkdtempSync(join(tmpdir(), 'relay-seed-'));
    const res = seed(db, dir);

    expect(res.taskCount).toBeGreaterThanOrEqual(6);
    expect(res.files.length).toBe(res.taskCount);
    // R-7 因执行者(执行·B)提问而原地挂起: 阶段留在执行中, hold=decision
    expect(getTask(db, 'R-7')!.hold).toBe('decision');
    expect(getTask(db, 'R-7')!.state).toBe('executing');
    // 镜像文件真的写出来了
    expect(readFileSync(join(dir, 'R-7.md'), 'utf8')).toContain('# 导出任务为 Markdown 报告');
  });

  // demo 数据不是随便塞几条 —— 它得把产品讲清楚。这条守住那几个叙事支点, 免得日后改 seed 时悄悄弄丢。
  it('demo 数据讲得出产品: 四阶段齐全 / 两种挂起各有 / 角色分工真实发生过', () => {
    const db = openDb(':memory:');
    seed(db, mkdtempSync(join(tmpdir(), 'relay-seed2-')));

    const states = (db.prepare('SELECT state, COUNT(*) c FROM tasks GROUP BY state').all() as { state: string; c: number }[]);
    const byState = Object.fromEntries(states.map((s) => [s.state, s.c]));
    for (const s of ALL_STATES) expect(byState[s], `${s} 列是空的, 看板会开天窗`).toBeGreaterThan(0);

    // 两种"轮到你"的挂起 → 顶栏"待你处理"演示得出来
    const holds = (db.prepare('SELECT hold, COUNT(*) c FROM tasks WHERE hold IS NOT NULL GROUP BY hold').all() as { hold: string; c: number }[]);
    const byHold = Object.fromEntries(holds.map((h) => [h.hold, h.c]));
    expect(byHold.confirm, '计划等拍板的挂起').toBe(1);
    // 提问产生两条 decision 挂起: 被挂起的父任务 + 问题卡自身
    expect(byHold.decision).toBe(2);
    // 挂起不搬站: R-7 仍在执行中列(原地举手)
    expect((db.prepare("SELECT state FROM tasks WHERE id='R-7'").get() as { state: string }).state).toBe('executing');

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
