import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { App } from './App';

const ALL_STATES = ['planning', 'awaiting_confirm', 'executing', 'awaiting_decision', 'testing', 'done'];

const projectCard = {
  id: 'P-1', title: '演示项目', state: 'executing', currentActor: 'a', currentRole: 'executor',
  parentId: null, goal: null, inputsMd: null, outputsMd: null, summary: null, priority: null,
  subtaskCount: 1, doneSubtaskCount: 0,
};
const projectBoard = ALL_STATES.map((s) => ({ state: s, tasks: s === 'executing' ? [projectCard] : [] }));

const taskCard = {
  id: 'R-1', title: '演示任务', state: 'executing', currentActor: 'a', currentRole: 'executor',
  parentId: 'P-1', goal: null, inputsMd: null, outputsMd: null, summary: null, priority: null,
};
const taskBoard = ALL_STATES.map((s) => ({ state: s, tasks: s === 'executing' ? [taskCard] : [] }));
const allTasksBoard = ALL_STATES.map((s) => ({ state: s, tasks: s === 'executing' ? [taskCard] : [] }));

const actors = [{ id: 'a', name: '执行A', type: 'agent', handle: null }];
const pkg = {
  task: taskCard, breadcrumb: [], inputs: { goal: '演示目标', inputsMd: null, depOutputs: [] },
  outputs: { outputsMd: null, summary: null }, clarifications: [], thread: [], subtasks: [], edges: { out: [], in: [] },
};

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(async (url: string) => ({
    ok: true,
    json: async () =>
      url.includes('/api/projects/') && url.includes('/board') ? taskBoard :
      url.includes('/api/tasks-board') ? allTasksBoard :
      url.includes('/api/projects') ? projectBoard :
      url.includes('/api/actors') ? actors :
      url.includes('/api/tree') ? [] :
      pkg,
  })) as any);
});

describe('App shell', () => {
  it('项目看板点项目跳到任务tab并带筛选', async () => {
    render(<App />);
    fireEvent.click(await screen.findByText('演示项目'));
    await waitFor(() => expect(screen.getByText('演示任务')).toBeInTheDocument());
    expect(screen.getByRole('button', { name: '任务' })).toHaveClass('active');
    expect(screen.getByText('演示项目')).toBeInTheDocument();
  });

  it('点任务打开详情', async () => {
    render(<App />);
    fireEvent.click(await screen.findByText('演示项目'));
    fireEvent.click(await screen.findByText('演示任务'));
    await waitFor(() => expect(screen.getByText('演示目标')).toBeInTheDocument());
  });

  it('点击背景遮罩关闭详情抽屉', async () => {
    const { container } = render(<App />);
    fireEvent.click(await screen.findByText('演示项目'));
    fireEvent.click(await screen.findByText('演示任务'));
    await waitFor(() => expect(screen.getByText('演示目标')).toBeInTheDocument());
    const backdrop = container.querySelector('.drawer-backdrop');
    expect(backdrop).toBeTruthy();
    fireEvent.click(backdrop!);
    await waitFor(() => expect(screen.queryByText('演示目标')).not.toBeInTheDocument());
  });

  it('看板加载失败时显示错误横幅', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, json: async () => ({ error: '数据库炸了' }) })) as any);
    render(<App />);
    expect(await screen.findByText(/数据库炸了/)).toBeInTheDocument();
  });
});
