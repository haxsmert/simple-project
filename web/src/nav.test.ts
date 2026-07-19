import { describe, it, expect } from 'vitest';
import { encodeNav, decodeNav } from './nav';

describe('导航 ↔ URL 编解码', () => {
  it('层级形态编解码往返一致(总览/树/钻取栈/全部任务)', () => {
    const cases: Array<{ view: 'board' | 'tree'; ids: string[] }> = [
      { view: 'board', ids: [] },                  // #/
      { view: 'tree', ids: [] },                   // #/tree
      { view: 'board', ids: ['all'] },             // #/b/all
      { view: 'board', ids: ['R-12'] },            // #/b/R-12
      { view: 'board', ids: ['R-12', 'R-14'] },    // 深钻
    ];
    for (const c of cases) {
      const decoded = decodeNav(encodeNav(c));
      expect({ view: decoded.view, ids: decoded.ids }, encodeNav(c)).toEqual(c);
      expect(decoded.taskId).toBeNull();
    }
  });

  it('抽屉=弹窗(2026-07-19 定调): 编码永不写 task 参数; 解码仍读它(深链一次性入口)', () => {
    // @ts-expect-error 传了 taskId 也不编码 —— 类型上已收窄, 运行时同样忽略
    expect(encodeNav({ view: 'board', ids: ['R-12'], taskId: 'R-7' })).toBe('#/b/R-12');
    expect(decodeNav('#/b/R-12?task=R-7')).toEqual({ view: 'board', ids: ['R-12'], taskId: 'R-7' });
    expect(decodeNav('#/tree?task=R-10').taskId).toBe('R-10');
  });

  it('容错: 空/怪 hash 落回项目总览, 不炸', () => {
    expect(decodeNav('')).toEqual({ view: 'board', ids: [], taskId: null });
    expect(decodeNav('#/')).toEqual({ view: 'board', ids: [], taskId: null });
    expect(decodeNav('#/瞎写的')).toEqual({ view: 'board', ids: [], taskId: null });
  });
});
