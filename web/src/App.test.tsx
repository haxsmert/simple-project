import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { App } from './App';

const board = [{ state: 'executing', tasks: [{ id: 'R-1', title: '演示任务', state: 'executing', currentActor: 'a', currentRole: 'executor', parentId: null, goal: null, inputsMd: null, outputsMd: null, summary: null, priority: null }] }, ...['planning','awaiting_confirm','awaiting_decision','testing','done'].map((s) => ({ state: s, tasks: [] }))];
const actors = [{ id: 'a', name: '执行A', type: 'agent', handle: null }];
const pkg = { task: board[0].tasks[0], breadcrumb: [], inputs: { goal: '演示目标', inputsMd: null, depOutputs: [] }, outputs: { outputsMd: null, summary: null }, clarifications: [], thread: [], subtasks: [], edges: { out: [], in: [] } };

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(async (url: string) => ({
    ok: true,
    json: async () => url.includes('/api/board') ? board : url.includes('/api/actors') ? actors : url.includes('/api/tree') ? [] : pkg,
  })) as any);
});

describe('App shell', () => {
  it('点卡片打开详情抽屉', async () => {
    render(<App />);
    fireEvent.click(await screen.findByText('演示任务'));
    await waitFor(() => expect(screen.getByText('演示目标')).toBeInTheDocument()); // 详情里的 goal
  });
});
