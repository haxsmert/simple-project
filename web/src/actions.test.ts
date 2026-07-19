import { describe, it, expect } from 'vitest';
import { actionsFor, projectActionsFor, ALL_ACTION_ENTRIES } from './actions';
import { canMove } from '../../src/core/stateMachine';
import type { TaskState, Hold } from './types';

const STATES: TaskState[] = ['planning', 'executing', 'testing', 'done'];
const HOLDS: Hold[] = [null, 'confirm', 'decision'];

describe('「下一步」动作表(阶段×挂起)', () => {
  // 结构性守卫: 界面给出的每个动作, 其位置变更(阶段×挂起)必须是状态机允许的 —— 拼不出必然报错的选项
  it('每个动作的去向都是 canMove 允许的位置变更', () => {
    for (const { from, action: a } of ALL_ACTION_ENTRIES) {
      const to = { state: a.toState, hold: a.toHold === undefined ? from.hold : a.toHold };
      expect(canMove(from, to), `${from.state}${from.hold ? `(${from.hold})` : ''} 的「${a.label}」→ ${to.state}${to.hold ? `(${to.hold})` : ''} 不合法`).toBe(true);
    }
  });

  it('完成无下一步; 等决策的出路是答复(刻意为空); 其余组合都有可做的动作(不留死胡同)', () => {
    expect(actionsFor('done', null)).toEqual([]);
    for (const s of STATES) expect(actionsFor(s, 'decision'), `${s} 等决策不该给动作 —— 出路是答复`).toEqual([]);
    for (const s of STATES.filter((x) => x !== 'done')) {
      expect(actionsFor(s, null).length, `${s} 没有任何可做的下一步`).toBeGreaterThan(0);
      expect(actionsFor(s, 'confirm').length, `${s} 挂着等确认却无批准/打回出路 —— 死胡同`).toBeGreaterThan(0);
    }
  });

  it('等确认的出路恒为 批准(前进一步)+ 打回(原地解除), 打回要理由', () => {
    for (const s of STATES.filter((x) => x !== 'done')) {
      const acts = actionsFor(s, 'confirm');
      const approve = acts.find((a) => a.key === 'approve')!;
      const bounce = acts.find((a) => a.key === 'bounce')!;
      expect(approve.toHold, '批准必须解除挂起').toBeNull();
      expect(bounce.toHold, '打回必须解除挂起').toBeNull();
      expect(bounce.toState, '打回是原地解除, 不搬站').toBe(s);
      expect(bounce.form?.kind, '打回不说哪里不行, 接手的人只能猜').toBe('reason');
    }
  });

  it('交给"人"的动作必须用 toHuman, 不能用 keepActor 冒充(否则 agent 会成为自己计划的批准人)', () => {
    const submit = actionsFor('planning', null).find((a) => a.key === 'submit')!;
    expect(submit.toHold, '提交确认 = 原地挂 confirm, 不是搬站').toBe('confirm');
    expect(submit.toHuman, 'toRole=decider 却没标 toHuman → 会把当前 agent 设成决策者').toBe(true);
    expect(submit.keepActor).toBeFalsy();
    for (const { action: a } of ALL_ACTION_ENTRIES) {
      if (a.toRole === 'decider') expect(a.keepActor, `${a.label}: 决策者不能靠 keepActor 指定`).toBeFalsy();
    }
  });

  it('要交东西的动作带内容面板: 两条推进路都必须有计划, 交测试必填产出', () => {
    const submit = actionsFor('planning', null).find((a) => a.key === 'submit')!;
    expect(submit.form?.kind).toBe('plan');
    expect(submit.form?.required, '空计划提交 = "提交了计划但没有计划"的自相矛盾').toBe(true);
    const start = actionsFor('planning', null).find((a) => a.key === 'start')!;
    expect(start.form?.kind, '"开始执行"跳过的是确认, 不是计划').toBe('plan');
    expect(start.form?.required).toBe(true);
    expect(start.form?.onlyIfMissing, '有计划时应一键直走, 守卫不该变成每次打断').toBe(true);
    const toTest = actionsFor('executing', null).find((a) => a.key === 'toTest')!;
    expect(toTest.form?.kind, '"做完了"必须有地方说做出了什么').toBe('output');
    const fail = actionsFor('testing', null).find((a) => a.key === 'fail')!;
    expect(fail.form?.kind).toBe('reason');
  });

  it('每个非完成阶段(未挂起)保留"纯改派" —— 行动者卡住时要能换人; 每组合最多一个主动作', () => {
    for (const s of STATES.filter((x) => x !== 'done')) {
      const r = actionsFor(s, null).find((a) => a.key === 'reassign');
      expect(r, `${s} 缺少改派动作`).toBeTruthy();
      expect(r!.toState, '改派不该改变阶段').toBe(s);
      expect(r!.toHold, '改派不该碰挂起(缺省=保持)').toBeUndefined();
    }
    for (const s of STATES) for (const h of HOLDS) {
      expect(actionsFor(s, h).filter((a) => a.primary).length, `${s}×${h} 的主动作不止一个`).toBeLessThanOrEqual(1);
    }
  });

  it('动作文案是给人看的: 有动词标签 + 说清后果的 hint, 不漏协议黑话', () => {
    for (const { action: a } of ALL_ACTION_ENTRIES) {
      expect(a.label.length).toBeGreaterThan(1);
      expect(a.hint.length).toBeGreaterThan(1);
      expect(a.done.length).toBeGreaterThan(1);
      expect(a.done).not.toBe(`已${a.label}`);
      expect(`${a.label}${a.hint}${a.done}`).not.toMatch(/换手|上一棒|下一棒|handoff|hold|confirm/i);
    }
  });
});

// 项目=大号任务(2026-07-19 定调): 两态动作表 —— 执行中给 完结/换负责人, 已完结给 重开; 全程不碰挂起
describe('项目动作表(两态)', () => {
  it('执行中: 完结关闭(带可选理由面板)+ 换负责人; 已完结: 重开; 动作恒不设挂起', () => {
    const active = projectActionsFor('executing', 'planner');
    expect(active.map((a) => a.key)).toEqual(['close', 'reassign']);
    const close = active.find((a) => a.key === 'close')!;
    expect(close.toState).toBe('done');
    expect(close.toHold, '项目不挂起').toBeNull();
    expect(close.keepActor, '完结不换人').toBe(true);
    expect(close.form?.kind, '完结理由记进「经过」(可选, 不强填)').toBe('reason');
    expect(close.form?.required).toBeFalsy();
    const done = projectActionsFor('done', 'planner');
    expect(done.map((a) => a.key)).toEqual(['reopen']);
    expect(done[0].toState, '重开 = done→executing 项目特例').toBe('executing');
    expect(done[0].toHold).toBeNull();
  });

  it('项目动作保角色(原地改派闸要求同角色), 缺省角色兜底 planner', () => {
    expect(projectActionsFor('executing', 'tester').every((a) => a.toRole === 'tester')).toBe(true);
    expect(projectActionsFor('executing', null).every((a) => a.toRole === 'planner')).toBe(true);
  });
});
