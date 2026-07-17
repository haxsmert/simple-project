import { describe, it, expect } from 'vitest';
import { NEXT_ACTIONS } from './actions';
import { TRANSITIONS, canTransition } from '../../src/core/stateMachine';
import type { TaskState } from './types';

const ALL: TaskState[] = ['planning', 'awaiting_confirm', 'executing', 'awaiting_decision', 'testing', 'done'];

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
