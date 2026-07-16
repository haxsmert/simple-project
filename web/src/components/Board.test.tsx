import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { Board } from './Board';
import type { BoardColumn } from '../types';

const columns: BoardColumn[] = [
  { state: 'executing', tasks: [{ id: 'R-1', title: '搭建数据层', state: 'executing', currentActor: 'a', currentRole: 'executor', parentId: null, goal: null, inputsMd: null, outputsMd: null, summary: null, priority: 'hi' }] },
  { state: 'awaiting_decision', tasks: [{ id: 'R-2', title: '要不要富文本', state: 'awaiting_decision', currentActor: 'you', currentRole: 'decider', parentId: null, goal: null, inputsMd: null, outputsMd: null, summary: null, priority: 'hi' }] },
  { state: 'planning', tasks: [] }, { state: 'awaiting_confirm', tasks: [] }, { state: 'testing', tasks: [] }, { state: 'done', tasks: [] },
];
const actors = { a: { id: 'a', name: '执行A', type: 'agent' as const, handle: null }, you: { id: 'you', name: '你', type: 'human' as const, handle: null } };

describe('Board', () => {
  it('渲染卡片, 待决策列高亮, 点击回调', () => {
    const onOpen = vi.fn();
    const { container } = render(<Board columns={columns} actorsById={actors} onOpen={onOpen} />);
    expect(screen.getByText('搭建数据层')).toBeInTheDocument();
    expect(container.querySelector('.col.attn')).toBeTruthy(); // 待决策列
    expect(container.querySelector('.card.blocked')).toBeTruthy(); // R-2 卡
    fireEvent.click(screen.getByText('搭建数据层'));
    expect(onOpen).toHaveBeenCalledWith('R-1');
  });
});
