import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ActorBadge } from './ActorBadge';
import { RoleChip } from './RoleChip';
import { EdgeChip } from './EdgeChip';

describe('primitives', () => {
  it('ActorBadge 人/agent 双编码', () => {
    const { container: c1 } = render(<ActorBadge actor={{ id: 'you', name: '你', type: 'human', handle: null }} />);
    expect(c1.querySelector('.actor.human')).toBeTruthy();
    const { container: c2 } = render(<ActorBadge actor={{ id: 'a', name: '执行A', type: 'agent', handle: null }} />);
    expect(c2.querySelector('.actor.agent')).toBeTruthy();
    const { container: c3 } = render(<ActorBadge actor={null} />);
    expect(c3.querySelector('.actor.none')).toBeTruthy();
  });
  it('RoleChip 显示角色名', () => {
    render(<RoleChip role="executor" />);
    expect(screen.getByText('执行')).toBeInTheDocument();
  });
  it('EdgeChip 按类型着色', () => {
    const { container } = render(<EdgeChip type="clarifies" />);
    expect(container.querySelector('.edge.await')).toBeTruthy();
  });
});
