import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { TaskDetail, fmtTime } from './TaskDetail';
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

describe('fmtTime', () => {
  it('裸 UTC ISO → 「MM-DD HH:mm」本地时间, 不再显示机器味的 T/Z/毫秒', () => {
    const out = fmtTime('2026-07-16T13:22:48.441Z');
    expect(out).toMatch(/^\d{2}-\d{2} \d{2}:\d{2}$/); // MM-DD HH:mm(具体值随本地时区, 不硬编码)
    expect(out).not.toContain('T');
    expect(out).not.toContain('Z');
  });
  it('纯日期(无时间)原样返回, 不编造时:分', () => {
    expect(fmtTime('2026-07-16')).toBe('2026-07-16');
  });
  it('无法解析的字符串原样返回', () => {
    expect(fmtTime('刚刚')).toBe('刚刚');
  });
});

describe('TaskDetail', () => {
  it('渲染四槽位并能答复待确认', () => {
    const onAnswer = vi.fn();
    render(<TaskDetail pkg={pkg} actorsById={actors} onAnswer={onAnswer} onHandoff={() => {}} onComment={() => {}} onClose={() => {}} />);
    expect(screen.getByText('搭建数据层')).toBeInTheDocument();
    expect(screen.getByText('建三张表')).toBeInTheDocument();          // 输入
    expect(screen.getByText(/schema.sql/)).toBeInTheDocument();        // 产出
    expect(screen.getByText('tasks 表')).toBeInTheDocument();          // 子任务
    // 答复待确认
    fireEvent.change(screen.getByPlaceholderText(/答复/), { target: { value: '方案A' } });
    fireEvent.click(screen.getByRole('button', { name: /答复/ }));
    expect(onAnswer).toHaveBeenCalledWith('R-148', '方案A');
  });

  it('决策优先: 待确认槽位排在「输入」之上, 换手降到「交互记录」之下', () => {
    const { container } = render(<TaskDetail pkg={pkg} actorsById={actors} onAnswer={() => {}} onHandoff={() => {}} onComment={() => {}} onClose={() => {}} />);
    const heads = Array.from(container.querySelectorAll('.slot-head h4')).map((h) => h.textContent);
    expect(heads.indexOf('待确认')).toBeGreaterThanOrEqual(0);
    expect(heads.indexOf('待确认')).toBeLessThan(heads.indexOf('输入'));      // 决策提到最顶
    expect(heads.indexOf('换手')).toBeGreaterThan(heads.indexOf('交互记录')); // 换手降到底部
  });

  it('待确认全部已决策时, 该槽位下沉到「输入」之下(不再占据决策优先的顶部)', () => {
    const resolvedPkg: TaskPackage = {
      ...pkg,
      task: { ...pkg.task, state: 'executing' },
      clarifications: [{ id: 'R-148', title: '待确认: 富文本?', state: 'done', currentActor: 'you', currentRole: 'decider', parentId: 'R-142', goal: '富文本?', inputsMd: null, outputsMd: null, summary: null, priority: 'hi' }],
    };
    const { container } = render(<TaskDetail pkg={resolvedPkg} actorsById={actors} onAnswer={() => {}} onHandoff={() => {}} onComment={() => {}} onClose={() => {}} />);
    const heads = Array.from(container.querySelectorAll('.slot-head h4')).map((h) => h.textContent);
    expect(heads.indexOf('待确认')).toBeGreaterThan(heads.indexOf('输入')); // 已决策=历史, 让位给输入/产出
  });

  it('点选项即答复(direct manipulation): 点 "A. 含全部" 直接以该选项答复', () => {
    const onAnswer = vi.fn();
    const optPkg: TaskPackage = {
      ...pkg,
      clarifications: [{ id: 'R-148', title: '待确认: 导出范围?', state: 'awaiting_decision', currentActor: 'you', currentRole: 'decider', parentId: 'R-142', goal: '导出范围?\n- A. 含全部\n- B. 仅未完成', inputsMd: null, outputsMd: null, summary: null, priority: 'hi' }],
    };
    render(<TaskDetail pkg={optPkg} actorsById={actors} onAnswer={onAnswer} onHandoff={() => {}} onComment={() => {}} onClose={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: /A\. 含全部/ }));
    expect(onAnswer).toHaveBeenCalledWith('R-148', 'A. 含全部');
  });

  it('待确认状态: 顶部出现「待你确认」计划块, 批准→执行中/执行者, 打回→待规划/规划者, 意见随动作带上', () => {
    const onHandoff = vi.fn();
    const confirmPkg: TaskPackage = { ...pkg, task: { ...pkg.task, state: 'awaiting_confirm' }, clarifications: [] };
    const { container } = render(<TaskDetail pkg={confirmPkg} actorsById={actors} onAnswer={() => {}} onHandoff={onHandoff} onComment={() => {}} onClose={() => {}} />);
    const heads = Array.from(container.querySelectorAll('.slot-head h4')).map((h) => h.textContent);
    expect(heads.indexOf('待你确认')).toBe(0); // 确认块在最顶
    expect(heads.indexOf('待你确认')).toBeLessThan(heads.indexOf('输入'));
    fireEvent.change(screen.getByPlaceholderText(/补充意见/), { target: { value: '注意并发' } });
    fireEvent.click(screen.getByRole('button', { name: /批准开工/ }));
    expect(onHandoff).toHaveBeenCalledWith(expect.objectContaining({ taskId: 'R-142', toState: 'executing', toRole: 'executor', toActor: 'a', note: '注意并发' }));
    fireEvent.click(screen.getByRole('button', { name: /打回重规划/ }));
    expect(onHandoff).toHaveBeenCalledWith(expect.objectContaining({ taskId: 'R-142', toState: 'planning', toRole: 'planner' }));
  });

  it('非待确认状态不出现确认块', () => {
    render(<TaskDetail pkg={pkg} actorsById={actors} onAnswer={() => {}} onHandoff={() => {}} onComment={() => {}} onClose={() => {}} />);
    expect(screen.queryByText('待你确认')).toBeNull();
    expect(screen.queryByRole('button', { name: /批准开工/ })).toBeNull();
  });

  it('换手控件调用 onHandoff', () => {
    const onHandoff = vi.fn();
    render(<TaskDetail pkg={pkg} actorsById={actors} onAnswer={() => {}} onHandoff={onHandoff} onComment={() => {}} onClose={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: '换手' }));
    expect(onHandoff).toHaveBeenCalledWith(expect.objectContaining({ taskId: 'R-142' }));
  });

  it('评论控件调用 onComment', () => {
    const onComment = vi.fn();
    render(<TaskDetail pkg={pkg} actorsById={actors} onAnswer={() => {}} onHandoff={() => {}} onComment={onComment} onClose={() => {}} />);
    fireEvent.change(screen.getByPlaceholderText('写条评论…'), { target: { value: '看这里' } });
    fireEvent.click(screen.getByRole('button', { name: '评论' }));
    expect(onComment).toHaveBeenCalledWith('R-142', '看这里');
  });

  it('时间线动词对齐真实 EventKind: output 渲染为"提交产出"而非原始英文 "output"', () => {
    const outputPkg: TaskPackage = {
      ...pkg,
      thread: [
        ...pkg.thread,
        { id: 'e2', taskId: 'R-142', actorId: 'a', kind: 'output', roleFrom: 'executor', roleTo: null, body: '交了产物', createdAt: '2026-07-16T03:00:00' },
      ],
    };
    render(<TaskDetail pkg={outputPkg} actorsById={actors} onAnswer={() => {}} onHandoff={() => {}} onComment={() => {}} onClose={() => {}} />);
    expect(screen.getByText(/提交产出/)).toBeInTheDocument();
    expect(screen.queryByText(/^output/)).toBeNull();
  });

  it('多个待确认并发时, 各卡片按自身问题定位提问方(而非全线程最后一条 clarify 事件)', () => {
    const multiPkg: TaskPackage = {
      ...pkg,
      clarifications: [
        { id: 'R-148', title: '待确认: 要不要富文本?', state: 'awaiting_decision', currentActor: 'you', currentRole: 'decider', parentId: 'R-142', goal: '要不要富文本?', inputsMd: null, outputsMd: null, summary: null, priority: 'hi' },
        { id: 'R-149', title: '待确认: 要不要暗色模式?', state: 'awaiting_decision', currentActor: 'you', currentRole: 'decider', parentId: 'R-142', goal: '要不要暗色模式?', inputsMd: null, outputsMd: null, summary: null, priority: 'hi' },
      ],
      thread: [
        { id: 'e1', taskId: 'R-142', actorId: 'a', kind: 'clarify', roleFrom: 'executor', roleTo: 'decider', body: '要不要富文本?', createdAt: '2026-07-16T01:00:00' },
        { id: 'e2', taskId: 'R-142', actorId: 'b', kind: 'clarify', roleFrom: 'executor', roleTo: 'decider', body: '要不要暗色模式?', createdAt: '2026-07-16T02:00:00' },
      ],
    };
    const multiActors = { ...actors, b: { id: 'b', name: '执行B', type: 'agent' as const, handle: null } };
    const { container } = render(<TaskDetail pkg={multiPkg} actorsById={multiActors} onAnswer={() => {}} onHandoff={() => {}} onComment={() => {}} onClose={() => {}} />);
    const clarCards = container.querySelectorAll('.clar');
    expect(clarCards.length).toBe(2);
    expect(within(clarCards[0] as HTMLElement).getByText('执行A')).toBeInTheDocument();
    expect(within(clarCards[0] as HTMLElement).queryByText('执行B')).toBeNull();
    expect(within(clarCards[1] as HTMLElement).getByText('执行B')).toBeInTheDocument();
    expect(within(clarCards[1] as HTMLElement).queryByText('执行A')).toBeNull();
  });
});
