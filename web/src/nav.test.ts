import { describe, it, expect } from 'vitest';
import { encodeNav, decodeNav, type NavState } from './nav';

describe('导航 ↔ URL 编解码', () => {
  it('全部形态编解码往返一致(总览/树/钻取栈/全部任务/带抽屉)', () => {
    const cases: NavState[] = [
      { view: 'board', ids: [], taskId: null },                       // #/
      { view: 'tree', ids: [], taskId: null },                        // #/tree
      { view: 'board', ids: ['all'], taskId: null },                  // #/b/all
      { view: 'board', ids: ['R-12'], taskId: null },                 // #/b/R-12
      { view: 'board', ids: ['R-12', 'R-14'], taskId: 'R-7' },        // 深钻 + 抽屉
      { view: 'tree', ids: [], taskId: 'R-10' },                      // 树 + 抽屉
    ];
    for (const c of cases) {
      expect(decodeNav(encodeNav(c)), encodeNav(c)).toEqual(c);
    }
  });

  it('容错: 空/怪 hash 落回项目总览, 不炸', () => {
    expect(decodeNav('')).toEqual({ view: 'board', ids: [], taskId: null });
    expect(decodeNav('#/')).toEqual({ view: 'board', ids: [], taskId: null });
    expect(decodeNav('#/瞎写的')).toEqual({ view: 'board', ids: [], taskId: null });
  });
});
