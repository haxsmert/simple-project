import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { TaskDetail, fmtTime } from './TaskDetail';
import type { TaskPackage } from '../types';

const pkg: TaskPackage = {
  task: { id: 'R-142', title: '搭建数据层', state: 'awaiting_decision', currentActor: 'a', currentRole: 'executor', parentId: 'R-1', goal: '建三张表', inputsMd: '计划…', outputsMd: '产物 schema.sql', summary: '进行中', priority: 'hi' },
  breadcrumb: [{ id: 'R-1', title: '项目', state: 'executing', currentActor: null, currentRole: null, parentId: null, goal: null, inputsMd: null, outputsMd: null, summary: null, priority: null }],
  inputs: { goal: '建三张表', inputsMd: '计划…', depOutputs: [{ taskId: 'R-140', title: 'MCP接口', summary: '锁定字段', outputsMd: null }] },
  outputs: { outputsMd: '产物 schema.sql', summary: '进行中' },
  clarifications: [{ id: 'R-148', title: '待确认: 富文本?', state: 'awaiting_decision', currentActor: 'you', currentRole: 'decider', parentId: 'R-142', goal: '富文本?', inputsMd: null, outputsMd: null, summary: null, priority: 'hi' }],
  thread: [{ id: 'e1', taskId: 'R-142', actorId: 'a', kind: 'clarify', roleFrom: 'executor', roleTo: 'decider', toActor: null, stateFrom: null, stateTo: null, body: '富文本?', createdAt: '2026-07-16' }],
  subtasks: [{ id: 'R-143', title: 'tasks 表', state: 'done', currentActor: null, currentRole: null, parentId: 'R-142', goal: null, inputsMd: null, outputsMd: null, summary: null, priority: null }],
  edges: { out: [{ id: 'x', fromTask: 'R-142', toTask: 'R-140', type: 'depends_on' }], in: [] },
};
const actors = { a: { id: 'a', name: '执行A', type: 'agent' as const, handle: null }, t: { id: 't', name: '测试T', type: 'agent' as const, handle: null }, you: { id: 'you', name: '你', type: 'human' as const, handle: null } };
// 默认路由表(后端按"最近谁在扮演该角色"推出): 界面据此预填交给谁
const H = (id: string) => ({ actorId: id, basis: 'history' as const });
const routing = { planner: H('a'), executor: H('a'), tester: H('t'), questioner: H('a'), decider: H('you') };

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
  it('渲染各槽位并能答复等你决定的问题', () => {
    const onAnswer = vi.fn();
    render(<TaskDetail pkg={pkg} actorsById={actors} routing={routing} onAnswer={onAnswer} onAct={async () => true} onComment={() => {}} onOpenTask={() => {}} onClose={() => {}} />);
    expect(screen.getByText('搭建数据层')).toBeInTheDocument();
    expect(screen.getByText('建三张表')).toBeInTheDocument();          // 输入
    expect(screen.getByText(/schema.sql/)).toBeInTheDocument();        // 产出
    expect(screen.getByText('tasks 表')).toBeInTheDocument();          // 子任务
    // 答复待确认
    fireEvent.change(screen.getByPlaceholderText(/答复/), { target: { value: '方案A' } });
    fireEvent.click(screen.getByRole('button', { name: /答复/ }));
    expect(onAnswer).toHaveBeenCalledWith('R-148', '方案A');
  });

  it('决策优先: 「等你决定」排在「任务内容」之上, 「下一步」降到「经过」之下', () => {
    const { container } = render(<TaskDetail pkg={pkg} actorsById={actors} routing={routing} onAnswer={() => {}} onAct={async () => true} onComment={() => {}} onOpenTask={() => {}} onClose={() => {}} />);
    const heads = Array.from(container.querySelectorAll('.slot-head h4')).map((h) => h.textContent);
    expect(heads.indexOf('等你决定')).toBe(0); // 轮到你 → 提到最顶
    expect(heads.indexOf('等你决定')).toBeLessThan(heads.indexOf('任务内容'));
    // 待决策的出路只有"答复"(答复后自动解冻), 故不给「下一步」——给了就能造出"问题挂着、任务在跑"的非法态
    expect(heads).not.toContain('下一步');
    expect(heads[heads.length - 1]).toBe('说点什么'); // 留言收尾
  });

  it('问题全部已决定时, 该槽位下沉到「任务内容」之下(不再占据顶部)', () => {
    const resolvedPkg: TaskPackage = {
      ...pkg,
      task: { ...pkg.task, state: 'executing' },
      clarifications: [{ id: 'R-148', title: '待确认: 富文本?', state: 'done', currentActor: 'you', currentRole: 'decider', parentId: 'R-142', goal: '富文本?', inputsMd: null, outputsMd: null, summary: null, priority: 'hi' }],
    };
    const { container } = render(<TaskDetail pkg={resolvedPkg} actorsById={actors} routing={routing} onAnswer={() => {}} onAct={async () => true} onComment={() => {}} onOpenTask={() => {}} onClose={() => {}} />);
    const heads = Array.from(container.querySelectorAll('.slot-head h4')).map((h) => h.textContent);
    expect(heads.indexOf('等你决定')).toBeGreaterThan(heads.indexOf('任务内容')); // 已决定=历史, 让位给内容
  });

  it('点选项即答复(direct manipulation): 点 "A. 含全部" 直接以该选项答复', () => {
    const onAnswer = vi.fn();
    const optPkg: TaskPackage = {
      ...pkg,
      clarifications: [{ id: 'R-148', title: '待确认: 导出范围?', state: 'awaiting_decision', currentActor: 'you', currentRole: 'decider', parentId: 'R-142', goal: '导出范围?\n- A. 含全部\n- B. 仅未完成', inputsMd: null, outputsMd: null, summary: null, priority: 'hi' }],
    };
    render(<TaskDetail pkg={optPkg} actorsById={actors} routing={routing} onAnswer={onAnswer} onAct={async () => true} onComment={() => {}} onOpenTask={() => {}} onClose={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: /A\. 含全部/ }));
    expect(onAnswer).toHaveBeenCalledWith('R-148', 'A. 含全部');
  });

  it('待确认: 顶部出现「等你拍板」, 批准→执行中/执行者, 打回→待规划/规划者, 说明随动作带上', async () => {
    const onAct = vi.fn().mockResolvedValue(true);
    const confirmPkg: TaskPackage = { ...pkg, task: { ...pkg.task, state: 'awaiting_confirm' }, clarifications: [] };
    const { container } = render(<TaskDetail pkg={confirmPkg} actorsById={actors} routing={routing} onAnswer={() => {}} onAct={onAct} onComment={() => {}} onOpenTask={() => {}} onClose={() => {}} />);
    const heads = Array.from(container.querySelectorAll('.slot-head h4')).map((h) => h.textContent);
    expect(heads.indexOf('等你拍板')).toBe(0); // 轮到你时提到最顶
    fireEvent.change(screen.getByPlaceholderText(/附一句说明/), { target: { value: '注意并发' } });
    fireEvent.click(screen.getByRole('button', { name: /批准开工/ }));
    await waitFor(() => expect(onAct).toHaveBeenCalledWith(
      expect.objectContaining({ taskId: 'R-142', toState: 'executing', toRole: 'executor', note: '注意并发' }),
      expect.objectContaining({ key: 'approve' })));
    fireEvent.click(screen.getByRole('button', { name: /打回重规划/ }));
    await waitFor(() => expect(onAct).toHaveBeenCalledWith(
      expect.objectContaining({ toState: 'planning', toRole: 'planner' }), expect.objectContaining({ key: 'bounce' })));
  });

  it('诚实性: 计划清单与子任务都不渲染复选框(勾不动的东西不许长成复选框)', () => {
    const planPkg: TaskPackage = { ...pkg, inputs: { ...pkg.inputs, inputsMd: '- [x] 令牌桶\n- [ ] 每 actor 配额' } };
    const { container } = render(<TaskDetail pkg={planPkg} actorsById={actors} routing={routing} onAnswer={() => {}} onAct={async () => true} onComment={() => {}} onOpenTask={() => {}} onClose={() => {}} />);
    expect(container.querySelector('input[type="checkbox"]')).toBeNull();
    expect(container.querySelector('ul.plan .ck')).toBeNull();
    expect(container.querySelector('.sub .cb')).toBeNull();
    expect(container.querySelectorAll('ul.plan .pmark').length).toBe(2); // 换成只读完成标记
    expect(container.querySelector('.sub .sdot')).toBeTruthy();          // 子任务用状态点
  });

  it('任务引用都是真链接: 子任务行 / 关系边+依赖 / 面包屑 点了都跳到该任务详情', () => {
    const onOpenTask = vi.fn();
    render(<TaskDetail pkg={pkg} actorsById={actors} routing={routing} onAnswer={() => {}} onAct={async () => true} onComment={() => {}} onOpenTask={onOpenTask} onClose={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: /tasks 表/ })); // 子任务行(R-143)
    expect(onOpenTask).toHaveBeenCalledWith('R-143');
    // R-140 既是依赖又是关系边目标: 两处都可跳, 且可及名各自说清关系(不能都叫裸 "R-140")
    fireEvent.click(screen.getByRole('button', { name: '打开依赖的任务 R-140' }));
    fireEvent.click(screen.getByRole('button', { name: '打开本任务指向的 R-140' }));
    expect(onOpenTask).toHaveBeenCalledWith('R-140');
    fireEvent.click(screen.getByRole('button', { name: '项目' })); // 面包屑祖先
    expect(onOpenTask).toHaveBeenCalledWith('R-1');
  });

  it('完成与否对读屏可感知(✓/圆点都是视觉的, 必须配隐藏文本)', () => {
    const planPkg: TaskPackage = { ...pkg, inputs: { ...pkg.inputs, inputsMd: '- [x] 令牌桶\n- [ ] 每 actor 配额' } };
    render(<TaskDetail pkg={planPkg} actorsById={actors} routing={routing} onAnswer={() => {}} onAct={async () => true} onComment={() => {}} onOpenTask={() => {}} onClose={() => {}} />);
    expect(screen.getByText('已完成')).toBeInTheDocument();
    expect(screen.getByText('未完成')).toBeInTheDocument();
  });

  it('抽屉内跳转后焦点落到新任务标题, 不掉回 body(键盘不断链)', () => {
    const { rerender, container } = render(<TaskDetail pkg={pkg} actorsById={actors} routing={routing} onAnswer={() => {}} onAct={async () => true} onComment={() => {}} onOpenTask={() => {}} onClose={() => {}} />);
    const next: TaskPackage = { ...pkg, task: { ...pkg.task, id: 'R-143', title: '跳过去的任务', state: 'executing' }, clarifications: [] };
    rerender(<TaskDetail pkg={next} actorsById={actors} routing={routing} onAnswer={() => {}} onAct={async () => true} onComment={() => {}} onOpenTask={() => {}} onClose={() => {}} />);
    const h2 = container.querySelector('h2') as HTMLElement;
    expect(h2.textContent).toBe('跳过去的任务');
    expect(document.activeElement).toBe(h2);
  });

  it('空槽位不渲染: 输入/产出/交互记录 没内容时连标题都不出现(不承诺不存在的内容)', () => {
    const bare: TaskPackage = {
      ...pkg,
      task: { ...pkg.task, state: 'executing', goal: null, inputsMd: null, outputsMd: null, summary: null },
      inputs: { goal: null, inputsMd: null, depOutputs: [] },
      outputs: { outputsMd: null, summary: null },
      clarifications: [], thread: [], subtasks: [], edges: { out: [], in: [] },
    };
    const { container } = render(<TaskDetail pkg={bare} actorsById={actors} routing={routing} onAnswer={() => {}} onAct={async () => true} onComment={() => {}} onOpenTask={() => {}} onClose={() => {}} />);
    const heads = Array.from(container.querySelectorAll('.slot-head h4')).map((h) => h.textContent);
    expect(heads).not.toContain('任务内容');
    expect(heads).not.toContain('做出了什么');
    expect(heads).not.toContain('经过');
    expect(heads).toEqual(['下一步', '说点什么']); // 只剩你能采取的动作
  });

  it('执行中: 只给合法的那一条, 且默认按路由自动派给测试者并写明交给谁(不用每次手选)', async () => {
    const onAct = vi.fn().mockResolvedValue(true);
    const execPkg: TaskPackage = { ...pkg, task: { ...pkg.task, state: 'executing' }, clarifications: [] };
    render(<TaskDetail pkg={execPkg} actorsById={actors} routing={routing} onAnswer={() => {}} onAct={onAct} onComment={() => {}} onOpenTask={() => {}} onClose={() => {}} />);
    expect(screen.queryByRole('button', { name: /验收通过/ })).toBeNull(); // 非法去向不给
    // 默认交给谁, 直接写在按钮上 —— 默认可见才叫"默认规则", 否则是黑箱
    expect(screen.getByText(/交给 测试T/)).toBeInTheDocument();
    expect(screen.queryByText('交给')).toBeNull(); // 不再有常驻的哑下拉
    fireEvent.click(screen.getByRole('button', { name: /交去测试/ }));
    await waitFor(() => expect(onAct).toHaveBeenCalledWith(
      expect.objectContaining({ toState: 'testing', toRole: 'tester', toActor: 't' }), // 按路由派给测试者, 不是瞎给第一个 agent
      expect.objectContaining({ key: 'toTest' })));
  });

  it('默认是"猜的"时如实说出来(没人扮演过该角色 → 别装成有规则)', () => {
    const guessRouting = { ...routing, tester: { actorId: 'a', basis: 'fallback' as const } };
    const execPkg: TaskPackage = { ...pkg, task: { ...pkg.task, state: 'executing' }, clarifications: [] };
    render(<TaskDetail pkg={execPkg} actorsById={actors} routing={guessRouting} onAnswer={() => {}} onAct={async () => true} onComment={() => {}} onOpenTask={() => {}} onClose={() => {}} />);
    expect(screen.getByText(/还没人做过这个角色, 先随便派的/)).toBeInTheDocument();
  });

  it('「换个人做」才是手动改人的入口: 点开出选择器, 且不含当前行动者', async () => {
    const onAct = vi.fn().mockResolvedValue(true);
    const execPkg: TaskPackage = { ...pkg, task: { ...pkg.task, state: 'executing', currentActor: 'a' }, clarifications: [] };
    render(<TaskDetail pkg={execPkg} actorsById={actors} routing={routing} onAnswer={() => {}} onAct={onAct} onComment={() => {}} onOpenTask={() => {}} onClose={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: '换个人做' }));
    const sel = screen.getByRole('combobox');
    expect([...sel.querySelectorAll('option')].map((o) => o.textContent)).not.toContain('执行A'); // 当前的人不该在"换成谁"里
    fireEvent.click(screen.getByRole('button', { name: '确定' }));
    await waitFor(() => expect(onAct).toHaveBeenCalledWith(
      expect.objectContaining({ toState: 'executing', toActor: 't' }), // 阶段不变, 只换人
      expect.objectContaining({ key: 'reassign' })));
  });

  it('评论控件调用 onComment', () => {
    const onComment = vi.fn();
    render(<TaskDetail pkg={pkg} actorsById={actors} routing={routing} onAnswer={() => {}} onAct={async () => true} onComment={onComment} onOpenTask={() => {}} onClose={() => {}} />);
    fireEvent.change(screen.getByPlaceholderText('写条评论…'), { target: { value: '看这里' } });
    fireEvent.click(screen.getByRole('button', { name: '评论' }));
    expect(onComment).toHaveBeenCalledWith('R-142', '看这里');
  });

  it('经过说清"谁交给了谁·状态怎么变": 多次换手不能长得一模一样', () => {
    const histPkg: TaskPackage = {
      ...pkg,
      thread: [
        { id: 'h1', taskId: 'R-142', actorId: 'you', kind: 'handoff', roleFrom: 'decider', roleTo: 'executor', toActor: 'a', stateFrom: 'awaiting_confirm', stateTo: 'executing', body: null, createdAt: '2026-07-17T08:49:00Z' },
        { id: 'h2', taskId: 'R-142', actorId: 'you', kind: 'handoff', roleFrom: 'executor', roleTo: 'tester', toActor: 't', stateFrom: 'executing', stateTo: 'testing', body: null, createdAt: '2026-07-17T08:49:00Z' },
        { id: 'h3', taskId: 'R-142', actorId: 'you', kind: 'handoff', roleFrom: 'tester', roleTo: 'tester', toActor: 'a', stateFrom: 'testing', stateTo: 'testing', body: null, createdAt: '2026-07-17T08:49:00Z' },
      ],
    };
    const { container } = render(<TaskDetail pkg={histPkg} actorsById={actors} routing={routing} onAnswer={() => {}} onAct={async () => true} onComment={() => {}} onOpenTask={() => {}} onClose={() => {}} />);
    const lines = [...container.querySelectorAll('.tline')].map((l) => l.textContent);
    expect(lines[0]).toContain('转交给 执行A · 待确认 → 执行中');
    expect(lines[1]).toContain('转交给 测试T · 执行中 → 测试中');
    expect(lines[2]).toContain('转交给 执行A');     // 同态改派: 阶段没变就别硬编变化
    expect(lines[2]).not.toContain('→');
    expect(new Set(lines).size).toBe(3);            // 三条各不相同 —— 这正是"四条一模一样"要防的
  });

  it('老事件(迁移前没记 to_actor)不编造: 有状态变化就说变化, 都没有就只说"转交"', () => {
    const oldPkg: TaskPackage = {
      ...pkg,
      thread: [
        { id: 'o1', taskId: 'R-142', actorId: 'you', kind: 'handoff', roleFrom: null, roleTo: 'executor', toActor: null, stateFrom: 'planning', stateTo: 'executing', body: null, createdAt: '2026-07-17T08:49:00Z' },
        { id: 'o2', taskId: 'R-142', actorId: 'you', kind: 'handoff', roleFrom: null, roleTo: 'executor', toActor: null, stateFrom: null, stateTo: null, body: null, createdAt: '2026-07-17T08:49:00Z' },
      ],
    };
    const { container } = render(<TaskDetail pkg={oldPkg} actorsById={actors} routing={routing} onAnswer={() => {}} onAct={async () => true} onComment={() => {}} onOpenTask={() => {}} onClose={() => {}} />);
    const lines = [...container.querySelectorAll('.tline')].map((l) => l.textContent);
    expect(lines[0]).toContain('推进到 待规划 → 执行中');
    expect(lines[1]).toContain('转交');
  });

  it('经过里的动词说人话: output 渲染为"交了产出"而非原始英文 "output"', () => {
    const outputPkg: TaskPackage = {
      ...pkg,
      thread: [
        ...pkg.thread,
        { id: 'e2', taskId: 'R-142', actorId: 'a', kind: 'output', roleFrom: 'executor', roleTo: null, toActor: null, stateFrom: null, stateTo: null, body: '交了产物', createdAt: '2026-07-16T03:00:00' },
      ],
    };
    render(<TaskDetail pkg={outputPkg} actorsById={actors} routing={routing} onAnswer={() => {}} onAct={async () => true} onComment={() => {}} onOpenTask={() => {}} onClose={() => {}} />);
    expect(screen.getByText(/交了产出/)).toBeInTheDocument();
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
        { id: 'e1', taskId: 'R-142', actorId: 'a', kind: 'clarify', roleFrom: 'executor', roleTo: 'decider', toActor: null, stateFrom: null, stateTo: null, body: '要不要富文本?', createdAt: '2026-07-16T01:00:00' },
        { id: 'e2', taskId: 'R-142', actorId: 'b', kind: 'clarify', roleFrom: 'executor', roleTo: 'decider', toActor: null, stateFrom: null, stateTo: null, body: '要不要暗色模式?', createdAt: '2026-07-16T02:00:00' },
      ],
    };
    const multiActors = { ...actors, b: { id: 'b', name: '执行B', type: 'agent' as const, handle: null } };
    const { container } = render(<TaskDetail pkg={multiPkg} actorsById={multiActors} routing={routing} onAnswer={() => {}} onAct={async () => true} onComment={() => {}} onOpenTask={() => {}} onClose={() => {}} />);
    const clarCards = container.querySelectorAll('.clar');
    expect(clarCards.length).toBe(2);
    expect(within(clarCards[0] as HTMLElement).getByText('执行A')).toBeInTheDocument();
    expect(within(clarCards[0] as HTMLElement).queryByText('执行B')).toBeNull();
    expect(within(clarCards[1] as HTMLElement).getByText('执行B')).toBeInTheDocument();
    expect(within(clarCards[1] as HTMLElement).queryByText('执行A')).toBeNull();
  });
});
