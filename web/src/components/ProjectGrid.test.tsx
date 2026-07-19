import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ProjectGrid } from './ProjectGrid';
import type { ProjectCard, Actor } from '../types';

// 项目层透镜的守约测试(2026-07-19 定调): 卡 = 目标 + 🔔 + 最近动静; 无进度百分比; 已完结折叠沉底
const actors: Record<string, Actor> = {
  a: { id: 'a', name: '执行·A', type: 'agent' },
  admin: { id: 'admin', name: 'admin', type: 'human' },
};
const base: Omit<ProjectCard, 'id' | 'title'> = {
  parentId: null, state: 'executing', hold: null, currentActor: 'admin', currentRole: 'planner',
  goal: '一个长期方向', planMd: null, outputsMd: null, summary: null, priority: null,
  attention: 0, lastEvent: null,
};

describe('ProjectGrid(项目总览)', () => {
  it('卡面 = 目标 + 🔔待处理 + 最近动静; 没写目标的存量项目如实提示, 不编内容', () => {
    render(<ProjectGrid overview={{
      active: [
        { ...base, id: 'R-1', title: '有活等你', attention: 2,
          lastEvent: { kind: 'handoff', actorId: 'a', actorName: '执行·A', taskId: 'R-2', taskTitle: '限流', toActor: 'admin', body: null, stateFrom: 'executing', stateTo: 'testing', holdFrom: null, holdTo: null, createdAt: '2026-07-19T00:00:00Z' } },
        { ...base, id: 'R-9', title: '没写目标的老项目', goal: null },
      ], closed: [],
    }} actorsById={actors} onOpen={() => {}} />);
    expect(screen.getByText('一个长期方向')).toBeInTheDocument();
    expect(screen.getByText('🔔 2 待你处理')).toBeInTheDocument();
    // 最近动静: 谁·干了什么(任务措辞)·在哪个任务
    expect(screen.getByText(/执行·A 转交给 admin · 执行中 → 测试中「限流」/)).toBeInTheDocument();
    expect(screen.getByText(/还没写目标/)).toBeInTheDocument(); // 空目标如实说
    expect(screen.getByText('还没动静')).toBeInTheDocument();   // 无事件不编
    expect(screen.queryByText(/%/)).toBeNull();                 // 无进度百分比(对持续流是假指标)
  });

  it('已完结折叠沉底(默认收起), 展开可见且标「已完结」; 点卡钻入', () => {
    const onOpen = vi.fn();
    render(<ProjectGrid overview={{
      active: [{ ...base, id: 'R-1', title: '活项目' }],
      closed: [{ ...base, id: 'R-16', title: '收官项目', state: 'done' }],
    }} actorsById={actors} onOpen={onOpen} />);
    expect(screen.getByText('已完结 1')).toBeInTheDocument();
    // details 默认收起, 但内容在 DOM(jsdom 不模拟折叠渲染) —— 至少验证归档章存在
    fireEvent.click(screen.getByText('已完结 1'));
    expect(screen.getByText('收官项目')).toBeInTheDocument();
    expect(screen.getByText('已完结')).toBeInTheDocument(); // 归档 chip
    fireEvent.click(screen.getByRole('button', { name: /活项目/ }));
    expect(onOpen).toHaveBeenCalledWith('R-1');
  });

  it('项目完结/重开事件用项目语言叙述(完结关闭/重开), 不说任务腔的"执行中 → 完成"', () => {
    render(<ProjectGrid overview={{
      active: [], closed: [
        { ...base, id: 'R-16', title: '刚收官', state: 'done',
          lastEvent: { kind: 'handoff', actorId: 'admin', actorName: 'admin', taskId: 'R-16', taskTitle: '刚收官', toActor: 'admin', body: '方向搁置', stateFrom: 'executing', stateTo: 'done', holdFrom: null, holdTo: null, createdAt: '2026-07-19T00:00:00Z' } },
      ],
    }} actorsById={actors} onOpen={() => {}} />);
    expect(screen.getByText(/admin 完结关闭: 方向搁置/)).toBeInTheDocument();
    expect(screen.queryByText(/执行中 → 完成/)).toBeNull();
  });
});
