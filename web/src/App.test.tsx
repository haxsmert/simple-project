import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { App } from './App';

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(async (url: string) => ({
    ok: true,
    json: async () =>
      url.includes('/api/board')
        ? [{ state: 'executing', tasks: [{ id: 'R-1', title: '演示任务', state: 'executing', currentActor: null, currentRole: null, parentId: null, priority: null }] }]
        : [],
  })) as any);
});

describe('App', () => {
  it('拉看板并渲染任务标题', async () => {
    render(<App />);
    expect(await screen.findByText('演示任务')).toBeInTheDocument();
  });
});
