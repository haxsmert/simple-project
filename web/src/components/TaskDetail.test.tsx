import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { TaskDetail } from './TaskDetail';
import type { TaskPackage } from '../types';

const pkg: TaskPackage = {
  task: { id: 'R-142', title: '搭建数据层', state: 'awaiting_decision', currentActor: 'a', currentRole: 'executor', parentId: 'R-1', goal: '建三张表', inputsMd: '计划…', outputsMd: '产物 schema.sql', summary: '进行中', priority: 'hi' },
  breadcrumb: [{ id: 'R-1', title: '项目', state: 'executing', currentActor: null, currentRole: null, parentId: null, goal: null, inputsMd: null, outputsMd: null, summary: null, priority: null }],
  inputs: { goal: '建三张表', inputsMd: '计划…', depOutputs: [{ taskId: 'R-140', title: 'MCP接口', summary: '锁定字段', outputsMd: null }] },
  outputs: { outputsMd: '产物 schema.sql', summary: '进行中' },
  clarifications: [{ id: 'R-148', title: '待确认: 富文本?', state: 'awaiting_decision', currentActor: 'you', currentRole: 'decider', parentId: 'R-142', goal: '富文本?', inputsMd: null, outputsMd: null, summary: null, priority: 'hi' }],
  thread: [{ id: 'e1', taskId: 'R-142', actorId: 'a', kind: 'clarify', roleFrom: 'executor', roleTo: 'decider', body: '富文本?', createdAt: '2026-07-16' }],
  subtasks: [{ id: 'R-143', title: 'tasks 表', state: 'done', currentActor: null, currentRole: null, parentId: 'R-142', goal: null, inputsMd: null, outputsMd: null, summary: null, priority: null }],
  edges: { out: [{ id: 'x', fromTask: 'R-142', toTask: 'R-140', type: 'depends_on' }], in: [] },
};
const actors = { a: { id: 'a', name: '执行A', type: 'agent' as const, handle: null }, you: { id: 'you', name: '你', type: 'human' as const, handle: null } };

describe('TaskDetail', () => {
  it('渲染四槽位并能答复待确认', () => {
    const onAnswer = vi.fn();
    render(<TaskDetail pkg={pkg} actorsById={actors} onAnswer={onAnswer} onClose={() => {}} />);
    expect(screen.getByText('搭建数据层')).toBeInTheDocument();
    expect(screen.getByText('建三张表')).toBeInTheDocument();          // 输入
    expect(screen.getByText(/schema.sql/)).toBeInTheDocument();        // 产出
    expect(screen.getByText('tasks 表')).toBeInTheDocument();          // 子任务
    // 答复待确认
    fireEvent.change(screen.getByPlaceholderText(/答复/), { target: { value: '方案A' } });
    fireEvent.click(screen.getByRole('button', { name: /答复/ }));
    expect(onAnswer).toHaveBeenCalledWith('R-148', '方案A');
  });
});
