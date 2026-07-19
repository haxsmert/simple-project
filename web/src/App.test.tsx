import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { App } from './App';

const ALL_STATES = ['planning', 'executing', 'testing', 'done'];

const projectCard = {
  id: 'P-1', title: '演示项目', state: 'executing', hold: null, currentActor: 'a', currentRole: 'executor',
  parentId: null, goal: '演示目标方向', planMd: null, outputsMd: null, summary: null, priority: null,
  attention: 2,
  lastEvent: {
    kind: 'comment', actorName: '执行A', taskId: 'R-1', taskTitle: '演示任务',
    toActor: null, body: '推进了一步', stateFrom: null, stateTo: null, holdFrom: null, holdTo: null,
    createdAt: '2026-07-19T00:00:00Z',
  },
};
// 项目总览两组结构(项目层透镜): 执行中 / 已完结
const projectBoard = { active: [projectCard], closed: [] };

const taskCard = {
  id: 'R-1', title: '演示任务', state: 'executing', hold: null, currentActor: 'a', currentRole: 'executor',
  parentId: 'P-1', goal: null, planMd: null, outputsMd: null, summary: null, priority: null,
};
const taskBoard = ALL_STATES.map((s) => ({ state: s, tasks: s === 'executing' ? [taskCard] : [] }));
const allTasksBoard = ALL_STATES.map((s) => ({ state: s, tasks: s === 'executing' ? [taskCard] : [] }));

const actors = [{ id: 'a', name: '执行A', type: 'agent' }];
const pkg = {
  task: taskCard, breadcrumb: [], inputs: { goal: '演示目标', planMd: null, depOutputs: [] },
  outputs: { outputsMd: null, summary: null }, clarifications: [], thread: [], subtasks: [], edges: { out: [], in: [] },
};

beforeEach(() => {
  window.history.replaceState(null, '', '#/'); // jsdom 的 hash 在测试间残留 → 初载会误恢复上个测试的位置
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
  it('导航同步到 URL: 钻入项目写 hash; 浏览器后退(popstate)恢复到项目总览 —— 后退/前进/深链因此可用', async () => {
    window.history.replaceState(null, '', '#/');
    render(<App />);
    fireEvent.click(await screen.findByText('演示项目')); // 钻入
    await waitFor(() => expect(window.location.hash).toBe('#/b/P-1'));
    // 模拟浏览器后退: hash 回根 + popstate 事件
    window.history.replaceState(null, '', '#/');
    fireEvent.popState(window);
    await waitFor(() => expect(screen.getByText('项目总览')).toBeInTheDocument());
    expect(screen.getByRole('button', { name: '返回上一层' })).toBeDisabled(); // 真回到了总览
  });

  it('打回请求把 toHold 真发到后端(传输层守护: 显式列举转发曾静默丢字段, 打回被误拦 —— 实锤)', async () => {
    const confirmPkg = {
      ...pkg,
      task: { ...taskCard, state: 'planning', hold: 'confirm', currentActor: 'admin', currentRole: 'decider' },
      inputs: { goal: null, planMd: '- [ ] 一步', depOutputs: [] },
    };
    const humanActors = [...actors, { id: 'admin', name: 'admin', type: 'human' }];
    (fetch as any).mockImplementation(async (url: string, opts?: RequestInit) => ({
      ok: true,
      json: async () =>
        url.includes('/api/handoff') ? confirmPkg.task :
        url.includes('/api/projects/') && url.includes('/board') ? taskBoard :
        url.includes('/api/tasks-board') ? allTasksBoard :
        url.includes('/api/projects') ? projectBoard :
        url.includes('/api/actors') ? humanActors :
        url.includes('/api/tree') ? [] :
        confirmPkg,
    }));
    render(<App />);
    fireEvent.click(await screen.findByText('演示项目'));
    fireEvent.click(await screen.findByText('演示任务')); // 打开抽屉(mock 返回等确认包)
    fireEvent.click(await screen.findByRole('button', { name: /打回重规划/ })); // 展开理由面板
    fireEvent.click(screen.getByRole('button', { name: '打回重规划' }));        // 确认
    await waitFor(() => {
      const call = (fetch as any).mock.calls.find(([u]: [string]) => u.includes('/api/handoff'));
      expect(call, '没有发出 handoff 请求').toBeTruthy();
      const body = JSON.parse(call[1].body);
      expect(body.toHold, '打回必须携带 toHold=null(解除挂起), 丢了会被"原地改派"闸误拦').toBeNull();
      expect(body.toState).toBe('planning');
      expect(body.toRole).toBe('planner');
    });
  });

  it('项目总览点项目 → 钻进任务看板, 面包屑第一格(picker)显示该项目', async () => {
    render(<App />);
    fireEvent.click(await screen.findByText('演示项目'));
    await waitFor(() => expect(screen.getByText('演示任务')).toBeInTheDocument());
    expect(screen.getByRole('button', { name: '项目总览' })).toBeInTheDocument(); // 根变成可点链接
    expect(screen.getByText('演示项目')).toBeInTheDocument(); // picker 显示当前项目(唯一一处, 卡面不再重复)
  });

  it('上一层按钮: 项目总览时禁用; 钻进项目后可用, 点它上溯回项目总览', async () => {
    render(<App />);
    await screen.findByText('演示项目');
    expect(screen.getByRole('button', { name: '返回上一层' })).toBeDisabled(); // 顶层无处可上
    fireEvent.click(screen.getByText('演示项目')); // 钻进项目
    await waitFor(() => expect(screen.getByText('演示任务')).toBeInTheDocument());
    const up = screen.getByRole('button', { name: '返回上一层' });
    expect(up).not.toBeDisabled();
    fireEvent.click(up); // 上一层 → 回项目总览
    await waitFor(() => expect(up).toBeDisabled()); // 回到顶层, 无处可上
    expect(screen.getByText('项目总览')).toBeInTheDocument(); // 根回到"当前"态
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

  it('项目卡 = 目标 + 🔔待处理 + 最近动静(项目层透镜, 无进度百分比), 顶栏展示可点击的全局 pill', async () => {
    render(<App />);
    await screen.findByText('演示项目');
    expect(screen.getByText('🔔 2 待你处理')).toBeInTheDocument();  // 待处理数做成醒目 pill
    expect(screen.getByText('演示目标方向')).toBeInTheDocument();    // 目标 = 项目为什么存在, 必须在卡面
    expect(screen.getByText(/执行A 留言「演示任务」: 推进了一步/)).toBeInTheDocument(); // 最近动静: 谁·干了什么·在哪个任务
    expect(screen.getByText('🔔 待你处理 2')).toBeInTheDocument();  // 顶栏全局 pill(文案顺序不同, 不与卡片撞)
  });

  it('顶栏 pill 点击后跳到「全部任务」扁平看板', async () => {
    render(<App />);
    fireEvent.click(await screen.findByText('🔔 待你处理 2'));
    await waitFor(() => expect(screen.getByText('演示任务')).toBeInTheDocument());
    expect(screen.getByText('全部任务')).toBeInTheDocument(); // picker 显示"全部任务"伪节点
  });

  it('未提交的追加任务草稿随导航废弃(防止建到错误父级)', async () => {
    render(<App />);
    fireEvent.click(await screen.findByText('演示项目')); // 钻进项目
    fireEvent.click(await screen.findByRole('button', { name: '+ 追加任务' }));
    const input = await screen.findByPlaceholderText('任务标题…');
    fireEvent.change(input, { target: { value: '半截草稿' } });
    fireEvent.click(screen.getByRole('button', { name: '返回上一层' })); // 导航离开
    await waitFor(() => expect(screen.queryByPlaceholderText('任务标题…')).not.toBeInTheDocument());
    fireEvent.click(await screen.findByText('演示项目')); // 再钻回来
    await waitFor(() => expect(screen.getByRole('button', { name: '+ 追加任务' })).toBeInTheDocument());
    expect(screen.queryByDisplayValue('半截草稿')).toBeNull(); // 草稿不残留
  });

  it('新建项目改为内联输入, 不再弹 window.prompt', async () => {
    const promptSpy = vi.spyOn(window, 'prompt');
    const calls: Array<{ url: string; opts?: RequestInit }> = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string, opts?: RequestInit) => {
      calls.push({ url, opts });
      return {
        ok: true,
        json: async () =>
          url.includes('/api/projects/') && url.includes('/board') ? taskBoard :
          url.includes('/api/tasks-board') ? allTasksBoard :
          url.includes('/api/projects') ? projectBoard :
          url.includes('/api/actors') ? actors :
          url.includes('/api/tree') ? [] :
          opts?.method === 'POST' ? { id: 'NEW-1', ...JSON.parse(String(opts.body)) } :
          pkg,
      };
    }) as any);

    render(<App />);
    fireEvent.click(await screen.findByRole('button', { name: '+ 新建项目' }));
    const input = await screen.findByPlaceholderText('项目标题…');
    expect(promptSpy).not.toHaveBeenCalled();

    fireEvent.change(input, { target: { value: '新项目A' } });
    // 项目必须写清目标(没写时确定按钮禁用 —— 项目不能只有一个名字)
    expect(screen.getByRole('button', { name: '确定' })).toBeDisabled();
    fireEvent.change(screen.getByPlaceholderText(/目标\/说明/), { target: { value: '一个新的长期方向' } });
    fireEvent.submit(input.closest('form')!);

    await waitFor(() => {
      const postCall = calls.find((c) => c.opts?.method === 'POST');
      expect(postCall).toBeTruthy();
      expect(JSON.parse(String(postCall!.opts!.body))).toMatchObject({ title: '新项目A', goal: '一个新的长期方向' });
    });
    await waitFor(() => expect(screen.queryByPlaceholderText('项目标题…')).not.toBeInTheDocument());
  });
});
