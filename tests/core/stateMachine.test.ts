import { describe, it, expect } from 'vitest';
import { canMove, defaultNext } from '../../src/core/stateMachine';

// 模型: 主干四阶段 + 平行的挂起字段。canMove 校验的是"位置"(阶段×挂起)的变更。
describe('stateMachine', () => {
  it('主干推进: 前进一步与测试返工合法, 跳跃与终态外流拒绝, 原地(纯改派)恒许', () => {
    const at = (state: Parameters<typeof canMove>[0]['state'], hold: Parameters<typeof canMove>[0]['hold'] = null) => ({ state, hold });
    expect(canMove(at('planning'), at('executing'))).toBe(true);
    expect(canMove(at('executing'), at('testing'))).toBe(true);
    expect(canMove(at('testing'), at('executing'))).toBe(true);  // 打回返工
    expect(canMove(at('testing'), at('done'))).toBe(true);
    expect(canMove(at('planning'), at('testing'))).toBe(false);  // 跳站
    expect(canMove(at('executing'), at('done'))).toBe(false);
    expect(canMove(at('done'), at('executing'))).toBe(false);
    expect(canMove(at('executing'), at('executing'))).toBe(true); // 原地改派
    expect(canMove(at('executing', 'decision'), at('executing', 'decision'))).toBe(true); // 挂起中也可改派
  });

  it('确认挂起是平行字段: 任何非完成阶段可挂; 解除 = 批准前进一步 或 打回原地', () => {
    const at = (state: Parameters<typeof canMove>[0]['state'], hold: Parameters<typeof canMove>[0]['hold'] = null) => ({ state, hold });
    expect(canMove(at('planning'), at('planning', 'confirm'))).toBe(true);   // 提交计划等确认
    expect(canMove(at('executing'), at('executing', 'confirm'))).toBe(true); // 执行产出也可以设卡
    expect(canMove(at('testing'), at('testing', 'confirm'))).toBe(true);
    expect(canMove(at('done'), at('done', 'confirm'))).toBe(false);          // 完成没有下一步, 不可挂
    expect(canMove(at('planning'), at('executing', 'confirm'))).toBe(false); // 挂起不能顺带搬站
    expect(canMove(at('planning', 'confirm'), at('executing'))).toBe(true);  // 批准 → 前进一步
    expect(canMove(at('planning', 'confirm'), at('planning'))).toBe(true);   // 打回 → 原地解除
    expect(canMove(at('planning', 'confirm'), at('testing'))).toBe(false);   // 批准也不能跳站
    // 挂着 confirm 不动、阶段却前进 → 会造出"执行中却还挂着等确认"的矛盾位(实锤漏洞, 钉死)
    expect(canMove(at('planning', 'confirm'), at('executing', 'confirm'))).toBe(false);
    expect(canMove(at('executing', 'confirm'), at('testing', 'confirm'))).toBe(false);
  });

  it('决策挂起由 clarification 专管: handoff 层面设/解一律拒(问题挂着任务不能跑)', () => {
    const at = (state: Parameters<typeof canMove>[0]['state'], hold: Parameters<typeof canMove>[0]['hold'] = null) => ({ state, hold });
    expect(canMove(at('executing'), at('executing', 'decision'))).toBe(false);
    expect(canMove(at('executing', 'decision'), at('executing'))).toBe(false);
    expect(canMove(at('executing', 'decision'), at('testing'))).toBe(false);
  });

  it('默认路由建议下一步', () => {
    expect(defaultNext('executing')).toEqual({ state: 'testing', role: 'tester' });
    expect(defaultNext('planning')).toEqual({ state: 'executing', role: 'executor' });
    expect(defaultNext('done')).toBeNull();
  });
});
