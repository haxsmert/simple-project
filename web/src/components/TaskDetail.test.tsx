import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { TaskDetail, fmtTime } from './TaskDetail';
import type { TaskPackage } from '../types';

const pkg: TaskPackage = {
  task: { id: 'R-142', title: '搭建数据层', state: 'executing', hold: 'decision', currentActor: 'a', currentRole: 'executor', parentId: 'R-1', goal: '建三张表', planMd: '计划…', outputsMd: '产物 schema.sql', summary: '进行中', priority: 'hi' },
  breadcrumb: [{ id: 'R-1', title: '项目', state: 'executing', hold: null, currentActor: null, currentRole: null, parentId: null, goal: null, planMd: null, outputsMd: null, summary: null, priority: null }],
  inputs: { goal: '建三张表', planMd: '计划…', depOutputs: [{ taskId: 'R-140', title: 'MCP接口', summary: '锁定字段', outputsMd: null }] },
  outputs: { outputsMd: '产物 schema.sql', summary: '进行中' },
  clarifications: [{ id: 'R-148', title: '待确认: 富文本?', state: 'planning', hold: 'decision', currentActor: 'admin', currentRole: 'decider', parentId: 'R-142', goal: '富文本?', planMd: null, outputsMd: null, summary: null, priority: 'hi' }],
  thread: [{ id: 'e1', taskId: 'R-142', actorId: 'a', kind: 'clarify', roleFrom: 'executor', roleTo: 'decider', toActor: null, stateFrom: null, stateTo: null, holdFrom: null, holdTo: null, body: '富文本?', createdAt: '2026-07-16' }],
  subtasks: [{ id: 'R-143', title: 'tasks 表', state: 'done', hold: null, currentActor: null, currentRole: null, parentId: 'R-142', goal: null, planMd: null, outputsMd: null, summary: null, priority: null }],
  edges: { out: [{ id: 'x', fromTask: 'R-142', toTask: 'R-140', type: 'depends_on', peerTitle: 'MCP接口' }], in: [] },
};
const actors = { a: { id: 'a', name: '执行A', type: 'agent' as const }, t: { id: 't', name: '测试T', type: 'agent' as const }, admin: { id: 'admin', name: 'admin', type: 'human' as const } };
// 默认路由表(后端按"最近谁在扮演该角色"推出): 界面据此预填交给谁
const H = (id: string) => ({ actorId: id, basis: 'history' as const });
const routing = { planner: H('a'), executor: H('a'), tester: H('t'), questioner: H('a'), decider: H('admin') };

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
      task: { ...pkg.task, state: 'executing', hold: null },
      clarifications: [{ id: 'R-148', title: '待确认: 富文本?', state: 'done', hold: null, currentActor: 'admin', currentRole: 'decider', parentId: 'R-142', goal: '富文本?', planMd: null, outputsMd: null, summary: null, priority: 'hi' }],
    };
    const { container } = render(<TaskDetail pkg={resolvedPkg} actorsById={actors} routing={routing} onAnswer={() => {}} onAct={async () => true} onComment={() => {}} onOpenTask={() => {}} onClose={() => {}} />);
    const heads = Array.from(container.querySelectorAll('.slot-head h4')).map((h) => h.textContent);
    expect(heads.indexOf('等你决定')).toBeGreaterThan(heads.indexOf('任务内容')); // 已决定=历史, 让位给内容
  });

  it('点选项即答复(direct manipulation): 点 "A. 含全部" 直接以该选项答复', () => {
    const onAnswer = vi.fn();
    const optPkg: TaskPackage = {
      ...pkg,
      clarifications: [{ id: 'R-148', title: '待确认: 导出范围?', state: 'planning', hold: 'decision', currentActor: 'admin', currentRole: 'decider', parentId: 'R-142', goal: '导出范围?\n- A. 含全部\n- B. 仅未完成', planMd: null, outputsMd: null, summary: null, priority: 'hi' }],
    };
    render(<TaskDetail pkg={optPkg} actorsById={actors} routing={routing} onAnswer={onAnswer} onAct={async () => true} onComment={() => {}} onOpenTask={() => {}} onClose={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: /A\. 含全部/ }));
    expect(onAnswer).toHaveBeenCalledWith('R-148', 'A. 含全部');
  });

  it('待确认: 顶部出现「等你拍板」, 批准→执行中/执行者; 打回先要一句理由, 理由随动作记进「经过」', async () => {
    const onAct = vi.fn().mockResolvedValue(true);
    const confirmPkg: TaskPackage = { ...pkg, task: { ...pkg.task, state: 'planning', hold: 'confirm', currentActor: 'admin' }, clarifications: [] };
    const { container } = render(<TaskDetail pkg={confirmPkg} actorsById={actors} routing={routing} onAnswer={() => {}} onAct={onAct} onComment={() => {}} onOpenTask={() => {}} onClose={() => {}} />);
    const heads = Array.from(container.querySelectorAll('.slot-head h4')).map((h) => h.textContent);
    expect(heads.indexOf('等你拍板')).toBe(0); // 轮到你时提到最顶
    fireEvent.change(screen.getByPlaceholderText(/附一句说明/), { target: { value: '注意并发' } });
    fireEvent.click(screen.getByRole('button', { name: /批准开工/ }));
    await waitFor(() => expect(onAct).toHaveBeenCalledWith(
      expect.objectContaining({ taskId: 'R-142', toState: 'executing', toRole: 'executor', note: '注意并发' }),
      expect.objectContaining({ key: 'approve' })));
    // 打回是两步: 点开出理由输入(不说哪里不行, 重规划的人只能猜), 确认才走
    fireEvent.click(screen.getByRole('button', { name: /打回重规划/ }));
    fireEvent.change(screen.getByPlaceholderText(/给接手的人指路/), { target: { value: '缺依赖分析' } });
    fireEvent.click(screen.getByRole('button', { name: '打回重规划' }));
    await waitFor(() => expect(onAct).toHaveBeenCalledWith(
      expect.objectContaining({ toState: 'planning', toRole: 'planner', note: '缺依赖分析' }),
      expect.objectContaining({ key: 'bounce' })));
  });

  it('拍板依据就在拍板处: 目标+计划渲染在「等你拍板」槽内(和批准按钮同址), 「任务内容」不再重复一份', () => {
    const confirmPkg: TaskPackage = {
      ...pkg,
      task: { ...pkg.task, state: 'planning', hold: 'confirm', currentActor: 'admin' }, clarifications: [],
      inputs: { ...pkg.inputs, planMd: '- [ ] 建表\n- [ ] 加索引' },
    };
    const { container } = render(<TaskDetail pkg={confirmPkg} actorsById={actors} routing={routing} onAnswer={() => {}} onAct={async () => true} onComment={() => {}} onOpenTask={() => {}} onClose={() => {}} />);
    const confirmSlot = container.querySelectorAll('.slot')[0] as HTMLElement; // 「等你拍板」在最顶
    expect(within(confirmSlot).getByText('建表')).toBeInTheDocument();       // 计划本体
    expect(within(confirmSlot).getByText(/建三张表/)).toBeInTheDocument();   // 目标
    expect(within(confirmSlot).getByText('批准开工')).toBeInTheDocument();   // 依据和动作同一屏
    expect(screen.getAllByText('建表').length).toBe(1); // 全抽屉只有一份计划, 不在「任务内容」再摆一份
  });

  it('「开始执行」是计划守卫: 没计划先要求写(随动作带走), 有计划一键直走不打断', async () => {
    const onAct = vi.fn().mockResolvedValue(true);
    const barePkg: TaskPackage = {
      ...pkg,
      task: { ...pkg.task, state: 'planning', hold: null }, clarifications: [],
      inputs: { goal: null, planMd: null, depOutputs: [] },
    };
    const { unmount } = render(<TaskDetail pkg={barePkg} actorsById={actors} routing={routing} onAnswer={() => {}} onAct={onAct} onComment={() => {}} onOpenTask={() => {}} onClose={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: '开始执行' }));
    expect(onAct).not.toHaveBeenCalled(); // 没计划不放行, 先展开要求写
    fireEvent.change(screen.getByPlaceholderText(/第一步/), { target: { value: '- [ ] 先搭骨架' } });
    fireEvent.click(screen.getByRole('button', { name: '开始执行' }));
    await waitFor(() => expect(onAct).toHaveBeenCalledWith(
      expect.objectContaining({ planMd: '- [ ] 先搭骨架', toState: 'executing' }),
      expect.objectContaining({ key: 'start' })));
    unmount();

    // 已有计划: 一键直走, 不再弹面板(守卫不是打断)
    const onAct2 = vi.fn().mockResolvedValue(true);
    const plannedPkg: TaskPackage = {
      ...pkg,
      task: { ...pkg.task, state: 'planning', hold: null }, clarifications: [],
      inputs: { ...pkg.inputs, planMd: '- [ ] 已有计划' },
    };
    render(<TaskDetail pkg={plannedPkg} actorsById={actors} routing={routing} onAnswer={() => {}} onAct={onAct2} onComment={() => {}} onOpenTask={() => {}} onClose={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: '开始执行' }));
    await waitFor(() => expect(onAct2).toHaveBeenCalledWith(
      expect.objectContaining({ toState: 'executing' }), expect.objectContaining({ key: 'start' })));
    expect((onAct2.mock.calls[0][0] as { planMd?: string }).planMd).toBeUndefined(); // 计划已在库里, 不重写
  });

  it('等确认在别人手里时不给批准/打回按钮(那不是你的关卡), 如实显示在谁手里', () => {
    const othersPkg: TaskPackage = {
      ...pkg,
      task: { ...pkg.task, state: 'planning', hold: 'confirm', currentActor: 'a' }, clarifications: [],
    };
    render(<TaskDetail pkg={othersPkg} actorsById={actors} routing={routing} onAnswer={() => {}} onAct={async () => true} onComment={() => {}} onOpenTask={() => {}} onClose={() => {}} />);
    expect(screen.queryByRole('button', { name: /批准开工/ })).toBeNull(); // 不递不属于你的动作
    expect(screen.getByText('等确认中')).toBeInTheDocument();
    expect(screen.getAllByText(/在 执行A 手里/).length).toBeGreaterThan(0); // 如实说在谁手里
  });

  it('父子最小不变量: 子未完时「验收通过」禁用并说明原因; 「交去测试」不拦但如实提示', () => {
    const withOpenChild: TaskPackage = {
      ...pkg,
      task: { ...pkg.task, state: 'testing', hold: null }, clarifications: [],
      subtasks: [{ id: 'R-143', title: '还没完的子任务', state: 'executing', hold: null, currentActor: null, currentRole: null, parentId: 'R-142', goal: null, planMd: null, outputsMd: null, summary: null, priority: null }],
    };
    const { unmount } = render(<TaskDetail pkg={withOpenChild} actorsById={actors} routing={routing} onAnswer={() => {}} onAct={async () => true} onComment={() => {}} onOpenTask={() => {}} onClose={() => {}} />);
    const pass = screen.getByRole('button', { name: /验收通过/ });
    expect(pass).toBeDisabled(); // 完成的任务不能有没完成的子(后端同拦, 界面直接说清不让人撞墙)
    expect(screen.getByText(/还有 1 个子任务未完成 —— 全完成才能收官/)).toBeInTheDocument();
    unmount();

    const execPkg: TaskPackage = { ...withOpenChild, task: { ...withOpenChild.task, state: 'executing' } };
    render(<TaskDetail pkg={execPkg} actorsById={actors} routing={routing} onAnswer={() => {}} onAct={async () => true} onComment={() => {}} onOpenTask={() => {}} onClose={() => {}} />);
    expect(screen.getByRole('button', { name: /交去测试/ })).toBeEnabled(); // 进测试不拦
    expect(screen.getByText(/还有 1 个子任务未完成/)).toBeInTheDocument();  // 但如实提示
  });

  it('「提交计划」就地写计划: 预填现有内容, 空计划不给提交, 提交时计划随动作带走', async () => {
    const onAct = vi.fn().mockResolvedValue(true);
    const planPkg: TaskPackage = {
      ...pkg,
      task: { ...pkg.task, state: 'planning', hold: null }, clarifications: [],
      inputs: { ...pkg.inputs, planMd: '- [ ] 老一步' },
    };
    render(<TaskDetail pkg={planPkg} actorsById={actors} routing={routing} onAnswer={() => {}} onAct={onAct} onComment={() => {}} onOpenTask={() => {}} onClose={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: /提交计划/ }));
    const ta = screen.getByPlaceholderText(/第一步/) as HTMLTextAreaElement;
    expect(ta.value).toBe('- [ ] 老一步'); // 预填已有计划, 不让人从零重打
    fireEvent.change(ta, { target: { value: '   ' } });
    expect(screen.getByRole('button', { name: '提交计划, 等我确认' })).toBeDisabled(); // 空计划 = 自相矛盾
    fireEvent.change(ta, { target: { value: '- [ ] 新一步' } });
    fireEvent.click(screen.getByRole('button', { name: '提交计划, 等我确认' }));
    await waitFor(() => expect(onAct).toHaveBeenCalledWith(
      // 提交确认 = 原地挂 confirm(不搬站), 交到人类决策者手里
      expect.objectContaining({ planMd: '- [ ] 新一步', toState: 'planning', toHold: 'confirm', toActor: 'admin' }),
      expect.objectContaining({ key: 'submit' })));
  });

  it('诚实性: 计划清单与子任务都不渲染复选框(勾不动的东西不许长成复选框)', () => {
    const planPkg: TaskPackage = { ...pkg, inputs: { ...pkg.inputs, planMd: '- [x] 令牌桶\n- [ ] 每 actor 配额' } };
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
    // R-140 既是依赖又是关系边目标: 两处都可跳, 且可及名各自说清"关系 + 标题"(不能都叫裸 "R-140")
    fireEvent.click(screen.getByRole('button', { name: '打开依赖的任务 MCP接口' }));
    fireEvent.click(screen.getByRole('button', { name: '打开本任务指向的 MCP接口' }));
    expect(onOpenTask).toHaveBeenCalledWith('R-140');
    fireEvent.click(screen.getByRole('button', { name: '项目' })); // 面包屑祖先
    expect(onOpenTask).toHaveBeenCalledWith('R-1');
  });

  it('引用不许裸编码: 依赖行和关系边的链接文本是"标题+编码", 不点进去也知道 R-140 是什么', () => {
    const { container } = render(<TaskDetail pkg={pkg} actorsById={actors} routing={routing} onAnswer={() => {}} onAct={async () => true} onComment={() => {}} onOpenTask={() => {}} onClose={() => {}} />);
    const links = [...container.querySelectorAll('.task-link')].map((l) => l.textContent);
    expect(links.length).toBe(2); // 依赖行 + 出边
    for (const text of links) {
      expect(text).toContain('MCP接口'); // 标题在场
      expect(text).toContain('R-140');   // 编码保留(检索/对账用), 但不独自出场
    }
  });

  it('完成与否对读屏可感知(✓/圆点都是视觉的, 必须配隐藏文本)', () => {
    const planPkg: TaskPackage = { ...pkg, inputs: { ...pkg.inputs, planMd: '- [x] 令牌桶\n- [ ] 每 actor 配额' } };
    render(<TaskDetail pkg={planPkg} actorsById={actors} routing={routing} onAnswer={() => {}} onAct={async () => true} onComment={() => {}} onOpenTask={() => {}} onClose={() => {}} />);
    expect(screen.getByText('已完成')).toBeInTheDocument();
    expect(screen.getByText('未完成')).toBeInTheDocument();
  });

  it('抽屉内跳转后焦点落到新任务标题, 不掉回 body(键盘不断链)', () => {
    const { rerender, container } = render(<TaskDetail pkg={pkg} actorsById={actors} routing={routing} onAnswer={() => {}} onAct={async () => true} onComment={() => {}} onOpenTask={() => {}} onClose={() => {}} />);
    const next: TaskPackage = { ...pkg, task: { ...pkg.task, id: 'R-143', title: '跳过去的任务', state: 'executing', hold: null }, clarifications: [] };
    rerender(<TaskDetail pkg={next} actorsById={actors} routing={routing} onAnswer={() => {}} onAct={async () => true} onComment={() => {}} onOpenTask={() => {}} onClose={() => {}} />);
    const h2 = container.querySelector('h2') as HTMLElement;
    expect(h2.textContent).toBe('跳过去的任务');
    expect(document.activeElement).toBe(h2);
  });

  it('空槽位不渲染: 输入/产出/交互记录 没内容时连标题都不出现(不承诺不存在的内容)', () => {
    const bare: TaskPackage = {
      ...pkg,
      task: { ...pkg.task, state: 'executing', hold: null, goal: null, planMd: null, outputsMd: null, summary: null },
      inputs: { goal: null, planMd: null, depOutputs: [] },
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

  it('执行中: 只给合法的那一条, 默认按路由派给测试者; 「做完了」先就地写产出(预填已有的), 产出随动作带走', async () => {
    const onAct = vi.fn().mockResolvedValue(true);
    const execPkg: TaskPackage = { ...pkg, task: { ...pkg.task, state: 'executing', hold: null }, clarifications: [] };
    render(<TaskDetail pkg={execPkg} actorsById={actors} routing={routing} onAnswer={() => {}} onAct={onAct} onComment={() => {}} onOpenTask={() => {}} onClose={() => {}} />);
    expect(screen.queryByRole('button', { name: /验收通过/ })).toBeNull(); // 非法去向不给
    // 默认交给谁, 直接写在按钮上 —— 默认可见才叫"默认规则", 否则是黑箱
    expect(screen.getByText(/交给 测试T/)).toBeInTheDocument();
    expect(screen.queryByText('交给')).toBeNull(); // 不再有常驻的哑下拉
    fireEvent.click(screen.getByRole('button', { name: /交去测试/ }));
    // 面板预填已写过的产出/摘要(不让人重打), 确认才转交
    expect((screen.getByPlaceholderText(/产物文件/) as HTMLTextAreaElement).value).toBe('产物 schema.sql');
    fireEvent.change(screen.getByPlaceholderText(/一句话摘要/), { target: { value: '三张表已建好' } });
    fireEvent.click(screen.getByRole('button', { name: '做完了, 交去测试' }));
    await waitFor(() => expect(onAct).toHaveBeenCalledWith(
      expect.objectContaining({
        toState: 'testing', toRole: 'tester', toActor: 't', // 按路由派给测试者, 不是瞎给第一个 agent
        outputs: { outputsMd: '产物 schema.sql', summary: '三张表已建好' },
      }),
      expect.objectContaining({ key: 'toTest' })));
  });

  it('默认是"猜的"时如实说出来(没人扮演过该角色 → 别装成有规则)', () => {
    const guessRouting = { ...routing, tester: { actorId: 'a', basis: 'fallback' as const } };
    const execPkg: TaskPackage = { ...pkg, task: { ...pkg.task, state: 'executing', hold: null }, clarifications: [] };
    render(<TaskDetail pkg={execPkg} actorsById={actors} routing={guessRouting} onAnswer={() => {}} onAct={async () => true} onComment={() => {}} onOpenTask={() => {}} onClose={() => {}} />);
    expect(screen.getByText(/还没人做过这个角色, 先随便派的/)).toBeInTheDocument();
  });

  it('「换个人做」才是手动改人的入口: 点开出选择器, 且不含当前行动者', async () => {
    const onAct = vi.fn().mockResolvedValue(true);
    const execPkg: TaskPackage = { ...pkg, task: { ...pkg.task, state: 'executing', hold: null, currentActor: 'a' }, clarifications: [] };
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
        { id: 'h1', taskId: 'R-142', actorId: 'admin', kind: 'handoff', roleFrom: 'decider', roleTo: 'executor', toActor: 'a', stateFrom: 'planning', stateTo: 'executing', holdFrom: 'confirm', holdTo: null, body: null, createdAt: '2026-07-17T08:49:00Z' },
        { id: 'h2', taskId: 'R-142', actorId: 'admin', kind: 'handoff', roleFrom: 'executor', roleTo: 'tester', toActor: 't', stateFrom: 'executing', stateTo: 'testing', holdFrom: null, holdTo: null, body: null, createdAt: '2026-07-17T08:49:00Z' },
        { id: 'h3', taskId: 'R-142', actorId: 'admin', kind: 'handoff', roleFrom: 'tester', roleTo: 'tester', toActor: 'a', stateFrom: 'testing', stateTo: 'testing', holdFrom: null, holdTo: null, body: null, createdAt: '2026-07-17T08:49:00Z' },
      ],
    };
    const { container } = render(<TaskDetail pkg={histPkg} actorsById={actors} routing={routing} onAnswer={() => {}} onAct={async () => true} onComment={() => {}} onOpenTask={() => {}} onClose={() => {}} />);
    const lines = [...container.querySelectorAll('.tline')].map((l) => l.textContent);
    expect(lines[0]).toContain('转交给 执行A · 批准通过 · 待规划 → 执行中'); // 挂起解除+阶段前进都说出来
    expect(lines[1]).toContain('转交给 测试T · 执行中 → 测试中');
    expect(lines[2]).toContain('转交给 执行A');     // 同态改派: 阶段没变就别硬编变化
    expect(lines[2]).not.toContain('→');
    expect(new Set(lines).size).toBe(3);            // 三条各不相同 —— 这正是"四条一模一样"要防的
  });

  it('老事件(迁移前没记 to_actor)不编造: 有状态变化就说变化, 都没有就只说"转交"', () => {
    const oldPkg: TaskPackage = {
      ...pkg,
      thread: [
        { id: 'o1', taskId: 'R-142', actorId: 'admin', kind: 'handoff', roleFrom: null, roleTo: 'executor', toActor: null, stateFrom: 'planning', stateTo: 'executing', holdFrom: null, holdTo: null, body: null, createdAt: '2026-07-17T08:49:00Z' },
        { id: 'o2', taskId: 'R-142', actorId: 'admin', kind: 'handoff', roleFrom: null, roleTo: 'executor', toActor: null, stateFrom: null, stateTo: null, holdFrom: null, holdTo: null, body: null, createdAt: '2026-07-17T08:49:00Z' },
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
        { id: 'e2', taskId: 'R-142', actorId: 'a', kind: 'output', roleFrom: 'executor', roleTo: null, toActor: null, stateFrom: null, stateTo: null, holdFrom: null, holdTo: null, body: '交了产物', createdAt: '2026-07-16T03:00:00' },
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
        { id: 'R-148', title: '待确认: 要不要富文本?', state: 'planning', hold: 'decision', currentActor: 'admin', currentRole: 'decider', parentId: 'R-142', goal: '要不要富文本?', planMd: null, outputsMd: null, summary: null, priority: 'hi' },
        { id: 'R-149', title: '待确认: 要不要暗色模式?', state: 'planning', hold: 'decision', currentActor: 'admin', currentRole: 'decider', parentId: 'R-142', goal: '要不要暗色模式?', planMd: null, outputsMd: null, summary: null, priority: 'hi' },
      ],
      thread: [
        { id: 'e1', taskId: 'R-142', actorId: 'a', kind: 'clarify', roleFrom: 'executor', roleTo: 'decider', toActor: null, stateFrom: null, stateTo: null, holdFrom: null, holdTo: null, body: '要不要富文本?', createdAt: '2026-07-16T01:00:00' },
        { id: 'e2', taskId: 'R-142', actorId: 'b', kind: 'clarify', roleFrom: 'executor', roleTo: 'decider', toActor: null, stateFrom: null, stateTo: null, holdFrom: null, holdTo: null, body: '要不要暗色模式?', createdAt: '2026-07-16T02:00:00' },
      ],
    };
    const multiActors = { ...actors, b: { id: 'b', name: '执行B', type: 'agent' as const } };
    const { container } = render(<TaskDetail pkg={multiPkg} actorsById={multiActors} routing={routing} onAnswer={() => {}} onAct={async () => true} onComment={() => {}} onOpenTask={() => {}} onClose={() => {}} />);
    const clarCards = container.querySelectorAll('.clar');
    expect(clarCards.length).toBe(2);
    expect(within(clarCards[0] as HTMLElement).getByText('执行A')).toBeInTheDocument();
    expect(within(clarCards[0] as HTMLElement).queryByText('执行B')).toBeNull();
    expect(within(clarCards[1] as HTMLElement).getByText('执行B')).toBeInTheDocument();
    expect(within(clarCards[1] as HTMLElement).queryByText('执行A')).toBeNull();
  });
});
