import { describe, it, expect } from 'vitest';
import { NEXT_ACTIONS } from './actions';
import { TRANSITIONS, canTransition } from '../../src/core/stateMachine';
import type { TaskState } from './types';

// 从表本身取, 不手抄 —— 手抄的清单会在新增状态时静默漏测
const ALL = Object.keys(NEXT_ACTIONS) as TaskState[];

describe('「下一步」动作表', () => {
  // 这条是结构性守卫: 原来的换手表单把全部 6 个状态列给使用者, 其中一半是状态机不允许的去向,
  // 点了必报「非法状态流转」。改成动作表后, 用这条测试钉死"界面永远给不出非法去向"。
  it('每个动作的去向都是状态机允许的流转(界面不可能提供必然报错的选项)', () => {
    for (const from of ALL) {
      for (const a of NEXT_ACTIONS[from]) {
        expect(canTransition(from, a.toState), `${from} → ${a.toState} (${a.label}) 不是合法流转`).toBe(true);
      }
    }
  });

  it('终态「完成」无下一步; 「待决策」的出路是答复(不在此表); 其余状态都有可做的动作(不留死胡同)', () => {
    expect(NEXT_ACTIONS.done).toEqual([]);
    expect(TRANSITIONS.done).toEqual([]);
    // 待决策刻意为空: 出路是答复它的问题(答复后状态机自动解冻)。给"不答复直接继续"会破坏
    // "所有待确认答复完才解冻"的不变量 —— 合法边 ≠ 该给的动作。
    expect(NEXT_ACTIONS.awaiting_decision).toEqual([]);
    for (const from of ALL.filter((s) => s !== 'done' && s !== 'awaiting_decision')) {
      expect(NEXT_ACTIONS[from].length, `${from} 没有任何可做的下一步`).toBeGreaterThan(0);
    }
  });

  it('交给"人"的动作必须用 toHuman, 不能用 keepActor 冒充(否则 agent 会成为自己计划的批准人)', () => {
    const submit = NEXT_ACTIONS.planning.find((a) => a.toRole === 'decider');
    expect(submit, '规划态应有一条"提交给人确认"的动作').toBeTruthy();
    expect(submit!.toHuman, 'toRole=decider 却没标 toHuman → 会把当前 agent 设成决策者').toBe(true);
    expect(submit!.keepActor).toBeFalsy();
    // 反向: 任何交给决策者的动作都不许 keepActor
    for (const from of ALL) {
      for (const a of NEXT_ACTIONS[from]) {
        if (a.toRole === 'decider') expect(a.keepActor, `${a.label}: 决策者不能靠 keepActor 指定`).toBeFalsy();
      }
    }
  });

  it('每个非终态都保留"纯改派"(同态换手) —— 行动者卡住时要能换人, 这是后端允许的能力', () => {
    for (const from of ['planning', 'executing', 'testing'] as TaskState[]) {
      const r = NEXT_ACTIONS[from].find((a) => a.key === 'reassign');
      expect(r, `${from} 缺少改派动作`).toBeTruthy();
      expect(r!.toState, '改派不该改变阶段').toBe(from);
      expect(canTransition(from, r!.toState), '同态换手应是合法流转').toBe(true);
    }
  });

  it('要交东西的动作带内容面板: 提交计划必填计划, 交测试必填产出, 打回带理由(光转交不交东西是空话)', () => {
    const submit = NEXT_ACTIONS.planning.find((a) => a.key === 'submit')!;
    expect(submit.form?.kind, '"提交计划"必须有地方写计划').toBe('plan');
    expect(submit.form?.required, '空计划提交 = "提交了计划但没有计划"的自相矛盾').toBe(true);
    // 确认关可以跳过, 计划不能跳过: 直接开工这条路同样必须有计划(已有则一键直走, 是守卫不是打断)
    const start = NEXT_ACTIONS.planning.find((a) => a.key === 'start')!;
    expect(start.form?.kind, '"开始执行"跳过的是确认, 不是计划').toBe('plan');
    expect(start.form?.required).toBe(true);
    expect(start.form?.onlyIfMissing, '有计划时应一键直走, 守卫不该变成每次打断').toBe(true);
    const toTest = NEXT_ACTIONS.executing.find((a) => a.key === 'toTest')!;
    expect(toTest.form?.kind, '"做完了"必须有地方说做出了什么').toBe('output');
    expect(toTest.form?.required).toBe(true);
    for (const a of [NEXT_ACTIONS.awaiting_confirm.find((x) => x.key === 'bounce')!, NEXT_ACTIONS.testing.find((x) => x.key === 'fail')!]) {
      expect(a.form?.kind, `「${a.label}」不说哪里不行, 接手的人只能猜`).toBe('reason');
    }
  });

  it('每个状态最多一个主动作(一屏一个主 CTA)', () => {
    for (const from of ALL) {
      expect(NEXT_ACTIONS[from].filter((a) => a.primary).length, `${from} 的主动作不止一个`).toBeLessThanOrEqual(1);
    }
  });

  it('动作文案是给人看的: 有动词标签 + 说清后果的 hint', () => {
    for (const from of ALL) {
      for (const a of NEXT_ACTIONS[from]) {
        expect(a.label.length).toBeGreaterThan(1);
        expect(a.hint.length).toBeGreaterThan(1);
        expect(a.done.length).toBeGreaterThan(1);
        // 回执语必须独立成句, 不能是"已"+label 硬拼(会出"已做完了, 交去测试"这种语病)
        expect(a.done).not.toBe(`已${a.label}`);
        // 界面上不出现接力棒比喻/协议黑话
        expect(`${a.label}${a.hint}${a.done}`).not.toMatch(/换手|上一棒|下一棒|handoff/i);
      }
    }
  });
});
