import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { Tree } from './Tree';
import type { TaskNode } from '../types';

const mk = (over: Partial<TaskNode>): TaskNode => ({
  id: 'R-1', title: 't', parentId: null, state: 'planning', currentActor: null, currentRole: null,
  goal: null, inputsMd: null, outputsMd: null, summary: null, priority: null, children: [], ...over,
});

const nodes: TaskNode[] = [
  mk({
    id: 'R-1', title: '项目A', state: 'executing', currentActor: 'admin',
    children: [
      mk({ id: 'R-2', title: '要不要富文本', state: 'awaiting_decision', parentId: 'R-1', currentActor: 'a' }),
    ],
  }),
];
const actors = { admin: { id: 'admin', name: 'admin', type: 'human' as const, handle: null }, a: { id: 'a', name: '执行A', type: 'agent' as const, handle: null } };

describe('Tree', () => {
  it('每行显示状态名, 递归渲染子节点, 负责人可见', () => {
    render(<Tree nodes={nodes} onOpen={() => {}} actorsById={actors} />);
    expect(screen.getByText('项目A')).toBeInTheDocument();
    expect(screen.getByText('执行中')).toBeInTheDocument();   // 父状态
    expect(screen.getByText('要不要富文本')).toBeInTheDocument(); // 递归到子节点
    expect(screen.getByText('执行A')).toBeInTheDocument();     // 子节点负责人
  });

  it('awaiting_decision 节点带"待你决策"标记(决策优先在树里也可见)', () => {
    render(<Tree nodes={nodes} onOpen={() => {}} actorsById={actors} />);
    expect(screen.getByText('待你决策')).toBeInTheDocument();
  });

  it('awaiting_confirm 节点带"待你确认"标记(确认关卡也在树里可见)', () => {
    const cn: TaskNode[] = [mk({ id: 'R-3', title: '计划待确认', state: 'awaiting_confirm' })];
    render(<Tree nodes={cn} onOpen={() => {}} actorsById={actors} />);
    expect(screen.getByText('待你确认')).toBeInTheDocument();
  });

  it('点节点行调用 onOpen(该节点 id)', () => {
    const onOpen = vi.fn();
    render(<Tree nodes={nodes} onOpen={onOpen} actorsById={actors} />);
    fireEvent.click(screen.getByText('要不要富文本'));
    expect(onOpen).toHaveBeenCalledWith('R-2');
  });
});
