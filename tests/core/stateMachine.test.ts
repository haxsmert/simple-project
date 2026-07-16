import { describe, it, expect } from 'vitest';
import { canTransition, defaultNext } from '../../src/core/stateMachine';

describe('stateMachine', () => {
  it('允许合法流转, 拒绝跳跃与终态外流', () => {
    expect(canTransition('executing', 'testing')).toBe(true);
    expect(canTransition('executing', 'awaiting_decision')).toBe(true);
    expect(canTransition('executing', 'done')).toBe(false);
    expect(canTransition('done', 'executing')).toBe(false);
    expect(canTransition('executing', 'executing')).toBe(true); // 同态
  });

  it('默认路由建议下一步', () => {
    expect(defaultNext('executing')).toEqual({ state: 'testing', role: 'tester' });
    expect(defaultNext('awaiting_decision')).toEqual({ state: 'executing', role: 'executor' });
    expect(defaultNext('done')).toBeNull();
  });
});
