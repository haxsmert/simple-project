import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
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

  it('卡片渲染优先级标记 / 子任务进度 / 关系边 chip(BoardCard 富化字段)', () => {
    const richColumns: BoardColumn[] = [
      {
        state: 'executing',
        tasks: [{
          id: 'R-20', title: '带富化信息的卡片', state: 'executing', currentActor: 'a', currentRole: 'executor',
          parentId: null, goal: null, inputsMd: null, outputsMd: null, summary: null, priority: 'hi',
          subtaskCount: 5, doneSubtaskCount: 3,
          edges: { out: [{ id: 'e1', fromTask: 'R-20', toTask: 'R-30', type: 'depends_on' }], in: [] },
        }],
      },
      { state: 'awaiting_decision', tasks: [] }, { state: 'planning', tasks: [] },
      { state: 'awaiting_confirm', tasks: [] }, { state: 'testing', tasks: [] }, { state: 'done', tasks: [] },
    ];
    const { container } = render(<Board columns={richColumns} actorsById={actors} onOpen={vi.fn()} />);
    expect(container.querySelector('.prio.hi')).toBeTruthy(); // 优先级菱形标记
    expect(container.querySelector('.sub-mini')).toBeTruthy(); // 子任务进度条
    expect(screen.getByText('子任务 3/5')).toBeInTheDocument();
    expect(container.querySelector('.edge.dep')).toBeTruthy(); // 依赖关系边 chip
  });

  it('待确认子任务卡片(clarifies 出边)只显示"待决策"阻塞 chip, 不重复渲染"待确认"边 chip', () => {
    const clarColumns: BoardColumn[] = [
      {
        state: 'awaiting_decision',
        tasks: [{
          id: 'R-148', title: '待确认: 要不要富文本?', state: 'awaiting_decision', currentActor: 'you', currentRole: 'decider',
          parentId: 'R-142', goal: null, inputsMd: null, outputsMd: null, summary: null, priority: 'hi',
          edges: { out: [{ id: 'e2', fromTask: 'R-148', toTask: 'R-142', type: 'clarifies' }], in: [] },
        }],
      },
    ];
    const { container } = render(<Board columns={clarColumns} actorsById={actors} onOpen={vi.fn()} />);
    const card = container.querySelector('.card') as HTMLElement;
    expect(within(card).getByText('待决策')).toBeInTheDocument();
    expect(within(card).queryAllByText('待确认').length).toBe(0);
    expect(card.querySelectorAll('.edge').length).toBe(1); // 仅阻塞 chip 本身, 无重复的 clarifies 边 chip
  });
});
