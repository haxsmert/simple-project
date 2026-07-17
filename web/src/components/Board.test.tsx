import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, within, createEvent } from '@testing-library/react';
import { Board, reorderIds } from './Board';
import type { BoardColumn } from '../types';

// 主干四阶段即四列; 挂起的任务留在自己的阶段列"原地举手"(整卡琥珀 + 挂起徽标), 不搬列
const columns: BoardColumn[] = [
  { state: 'planning', tasks: [] },
  {
    state: 'executing',
    tasks: [
      { id: 'R-1', title: '搭建数据层', state: 'executing', hold: null, currentActor: 'a', currentRole: 'executor', parentId: null, goal: null, inputsMd: null, outputsMd: null, summary: null, priority: 'hi' },
      { id: 'R-2', title: '要不要富文本', state: 'executing', hold: 'decision', currentActor: 'admin', currentRole: 'decider', parentId: null, goal: null, inputsMd: null, outputsMd: null, summary: null, priority: 'hi' },
    ],
  },
  { state: 'testing', tasks: [] },
  { state: 'done', tasks: [] },
];
const actors = { a: { id: 'a', name: '执行A', type: 'agent' as const, handle: null }, admin: { id: 'admin', name: 'admin', type: 'human' as const, handle: null } };

const fourCols = (tasks: BoardColumn['tasks'], at: BoardColumn['state'] = 'executing'): BoardColumn[] =>
  (['planning', 'executing', 'testing', 'done'] as const).map((state) => ({ state, tasks: state === at ? tasks : [] }));

// 同一列(executing)下 3 张卡片, 专供拖拽排序测试使用
const dragColumns: BoardColumn[] = fourCols((['R-1', 'R-2', 'R-3'] as const).map((id, i) => ({
  id, title: `任务${i + 1}`, state: 'executing', hold: null, currentActor: 'a', currentRole: 'executor',
  parentId: null, goal: null, inputsMd: null, outputsMd: null, summary: null, priority: 'hi',
})));

describe('Board', () => {
  it('渲染卡片, 挂起的卡原地高亮, 点击回调', () => {
    const onOpen = vi.fn();
    const { container } = render(<Board columns={columns} actorsById={actors} onOpen={onOpen} />);
    expect(screen.getByText('搭建数据层')).toBeInTheDocument();
    expect(container.querySelector('.card.blocked')).toBeTruthy(); // R-2: 挂起卡琥珀
    fireEvent.click(screen.getByText('搭建数据层'));
    expect(onOpen).toHaveBeenCalledWith('R-1');
  });

  it('卡片键盘可达: 标题是原生按钮(可 Tab 聚焦/回车打开), 卡片本体不再是 role=button(无嵌套交互)', () => {
    const onOpen = vi.fn();
    const { container } = render(<Board columns={columns} actorsById={actors} onOpen={onOpen} />);
    const card = container.querySelector('.card') as HTMLElement; // R-1
    expect(card.getAttribute('role')).toBeNull(); // 不再嵌套交互
    const titleBtn = within(card).getByRole('button', { name: /搭建数据层/ }); // aria-label 以标题开头
    expect(titleBtn.tagName).toBe('BUTTON');
    fireEvent.click(titleBtn);
    expect(onOpen).toHaveBeenCalledWith('R-1');
  });

  it('卡面降噪: 子任务进度保留; 优先级不用文字标签(位置即优先级), 关系边/角色/状态 chip 一律不上卡面', () => {
    const richColumns = fourCols([{
      id: 'R-20', title: '带富化信息的卡片', state: 'executing', hold: null, currentActor: 'a', currentRole: 'executor',
      parentId: null, goal: null, inputsMd: null, outputsMd: null, summary: null, priority: 'hi',
      subtaskCount: 5, doneSubtaskCount: 3,
      edges: { out: [{ id: 'e1', fromTask: 'R-20', toTask: 'R-30', type: 'depends_on' }], in: [] },
    }]);
    const { container } = render(<Board columns={richColumns} actorsById={actors} onOpen={vi.fn()} />);
    // 列是队列, 越靠前越优先(排序由后端按 rank→priority→id 落位)——"高/中/低"文字没人读得懂, 不上卡面
    expect(container.querySelector('.prio')).toBeNull();
    expect(screen.queryByText('高')).toBeNull();
    expect(container.querySelector('.sub-mini')).toBeTruthy(); // 子任务进度条
    expect(screen.getByText('子任务 3/5')).toBeInTheDocument();
    expect(container.querySelector('.edge')).toBeNull(); // 关系边不再上卡面(详情抽屉仍有)
    expect(container.querySelector('.role')).toBeNull(); // 角色 chip 不再上卡面
  });

  it('挂起的卡"原地举手": 留在自己的阶段列, 整卡琥珀 + 「待你决策/待你确认」徽标; 读屏 aria-label 同样带上', () => {
    const holdColumns: BoardColumn[] = [
      { state: 'planning', tasks: [{ id: 'R-149', title: '计划待确认的任务', state: 'planning', hold: 'confirm', currentActor: 'admin', currentRole: 'decider', parentId: 'R-142', goal: null, inputsMd: null, outputsMd: null, summary: null, priority: null }] },
      { state: 'executing', tasks: [{ id: 'R-148', title: '要不要富文本?', state: 'executing', hold: 'decision', currentActor: 'admin', currentRole: 'decider', parentId: 'R-142', goal: null, inputsMd: null, outputsMd: null, summary: null, priority: 'hi' }] },
      { state: 'testing', tasks: [] }, { state: 'done', tasks: [] },
    ];
    const { container } = render(<Board columns={holdColumns} actorsById={actors} onOpen={vi.fn()} />);
    const cards = container.querySelectorAll('.card');
    expect(cards[0].className).toContain('blocked'); // 等确认卡琥珀
    expect(cards[1].className).toContain('blocked'); // 等决策卡也琥珀("轮到你"同语言)
    // 挂起不再是列 —— 列头没法替它说话, 卡面必须自己说
    expect(within(cards[0] as HTMLElement).getByText('待你确认')).toBeInTheDocument();
    expect(within(cards[1] as HTMLElement).getByText('待你决策')).toBeInTheDocument();
    expect(within(cards[1] as HTMLElement).getByRole('button', { name: /待你决策/ })).toBeInTheDocument(); // 读屏可及名保留
  });

  it('项目名只在跨项目视图(showProject)显示; 单项目视图里不重复渲染同一项目名', () => {
    const projTitleColumns = fourCols([{
      id: 'R-80', title: '带项目名的任务', state: 'executing', hold: null, currentActor: 'a', currentRole: 'executor',
      parentId: 'R-79', goal: null, inputsMd: null, outputsMd: null, summary: null, priority: 'hi',
      parentTitle: '演示项目',
    }]);
    const { container: withProj } = render(<Board columns={projTitleColumns} actorsById={actors} onOpen={vi.fn()} showProject />);
    expect(withProj.querySelector('.card-project')?.textContent).toBe('演示项目'); // 全部任务视图: 显示
    const { container: withoutProj } = render(<Board columns={projTitleColumns} actorsById={actors} onOpen={vi.fn()} />);
    expect(withoutProj.querySelector('.card-project')).toBeFalsy(); // 单项目视图: 不重复
  });

  it('提供 onDescend 时「子任务 N/M」变成"钻入"入口, 点击调用 onDescend 且不触发 onOpen(详情)', () => {
    const onOpen = vi.fn(); const onDescend = vi.fn();
    const cols = fourCols([{ id: 'R-20', title: '有子任务的任务', state: 'executing', hold: null, currentActor: 'a', currentRole: 'executor', parentId: null, goal: null, inputsMd: null, outputsMd: null, summary: null, priority: null, subtaskCount: 3, doneSubtaskCount: 1 }]);
    render(<Board columns={cols} actorsById={actors} onOpen={onOpen} onDescend={onDescend} />);
    fireEvent.click(screen.getByTitle('钻入子任务'));
    expect(onDescend).toHaveBeenCalledWith('R-20');
    expect(onOpen).not.toHaveBeenCalled(); // 钻入不应顺带打开详情
  });

  it('不提供 onDescend 时「子任务 N/M」是纯展示(无钻入按钮)', () => {
    const cols = fourCols([{ id: 'R-20', title: '有子任务的任务', state: 'executing', hold: null, currentActor: 'a', currentRole: 'executor', parentId: null, goal: null, inputsMd: null, outputsMd: null, summary: null, priority: null, subtaskCount: 3, doneSubtaskCount: 1 }]);
    render(<Board columns={cols} actorsById={actors} onOpen={vi.fn()} />);
    expect(screen.queryByTitle('钻入子任务')).toBeNull();
    expect(screen.getByText(/子任务 1\/3/)).toBeInTheDocument();
  });

  it('项目卡 attention 渲染「N 待处理」聚合角标(唯一上卡面的 chip)', () => {
    const cols = fourCols([{ id: 'R-1', title: '项目A', state: 'planning', hold: null, currentActor: null, currentRole: null, parentId: null, goal: null, inputsMd: null, outputsMd: null, summary: null, priority: null, attention: 2 }], 'planning');
    render(<Board columns={cols} actorsById={actors} onOpen={vi.fn()} />);
    expect(screen.getByText('2 待处理')).toBeInTheDocument(); // 聚合信号非重复信息, 保留
  });

  it('全空看板渲染 board-empty 与提示文案', () => {
    const { container } = render(
      <Board columns={fourCols([])} actorsById={actors} onOpen={vi.fn()}
        emptyHint={<><b>还没有任务</b><div>去追加一个吧</div></>} />
    );
    expect(container.querySelector('.board-empty')).toBeTruthy();
    expect(screen.getByText('还没有任务')).toBeInTheDocument();
    expect(screen.getByText('去追加一个吧')).toBeInTheDocument();
    expect(container.querySelector('.board')).toBeFalsy();
  });

  it('部分列为空时, 空列渲染 col-empty 占位; 主干四阶段即四列', () => {
    const { container } = render(<Board columns={columns} actorsById={actors} onOpen={vi.fn()} />);
    expect(container.querySelectorAll('.col').length).toBe(4);
    // planning/testing/done 列在 fixture 里没有任务
    expect(container.querySelectorAll('.col-empty').length).toBe(3);
  });

  it('传入 onReorder 时卡片可拖拽(draggable=true); 不传时卡片不可拖拽', () => {
    const { container: withReorder } = render(<Board columns={columns} actorsById={actors} onOpen={vi.fn()} onReorder={vi.fn()} />);
    expect((withReorder.querySelector('.card') as HTMLElement).getAttribute('draggable')).toBe('true');

    const { container: withoutReorder } = render(<Board columns={columns} actorsById={actors} onOpen={vi.fn()} />);
    expect((withoutReorder.querySelector('.card') as HTMLElement).getAttribute('draggable')).not.toBe('true');
  });

  it('同列内拖拽: 拖到某张卡片之前, onReorder 收到插到该卡之前的新顺序(dragStart/drop 事件模拟)', () => {
    const onReorder = vi.fn();
    const { container } = render(<Board columns={dragColumns} actorsById={actors} onOpen={vi.fn()} onReorder={onReorder} />);
    const cards = container.querySelectorAll('.card');
    fireEvent.dragStart(cards[0]); // 拖起 R-1
    fireEvent.dragOver(cards[2]); // 悬停在 R-3 上
    fireEvent.drop(cards[2]); // 松手在 R-3 上 → R-1 插到 R-3 之前
    expect(onReorder).toHaveBeenCalledWith(['R-2', 'R-1', 'R-3']);
  });

  it('同列内拖拽到列尾空白区域: onReorder 收到追加到末尾的新顺序', () => {
    const onReorder = vi.fn();
    const { container } = render(<Board columns={dragColumns} actorsById={actors} onOpen={vi.fn()} onReorder={onReorder} />);
    const cards = container.querySelectorAll('.card');
    const colEls = container.querySelectorAll('.cards');
    fireEvent.dragStart(cards[0]); // 拖起 R-1(在 executing 列)
    fireEvent.drop(colEls[1]); // 松手在该列的空白容器上(未命中任何卡片)
    expect(onReorder).toHaveBeenCalledWith(['R-2', 'R-3', 'R-1']);
  });

  it('reorderIds 纯函数: 插到目标之前 / 追加到列尾(不依赖 DOM 事件, 保证非 flaky)', () => {
    expect(reorderIds(['a', 'b', 'c'], 'a', 'c')).toEqual(['b', 'a', 'c']); // 拖 a 到 c 之前
    expect(reorderIds(['a', 'b', 'c'], 'c', 'a')).toEqual(['c', 'a', 'b']); // 拖 c 到 a 之前
    expect(reorderIds(['a', 'b', 'c'], 'b', null)).toEqual(['a', 'c', 'b']); // 拖 b 到列尾
  });

  it('reorderIds after=true: 插到目标之后(向下拖的正确语义, 修复"下拉不生效"+可移到末位)', () => {
    expect(reorderIds(['a', 'b', 'c'], 'a', 'b', true)).toEqual(['b', 'a', 'c']);  // a 落到 b 下半 → a 移到 b 之后
    expect(reorderIds(['a', 'b', 'c'], 'a', 'c', true)).toEqual(['b', 'c', 'a']);  // a 落到末卡 c 下半 → a 移到末位
    expect(reorderIds(['a', 'b', 'c'], 'a', 'b', false)).toEqual(['a', 'b', 'c']); // a 落到 b 上半 → 之前 = 原位, 不动
  });

  it('向下拖到卡片下半部分: 插到该卡之后(修复"下拉不生效"), 可把卡移到列末位', () => {
    const onReorder = vi.fn();
    const { container } = render(<Board columns={dragColumns} actorsById={actors} onOpen={vi.fn()} onReorder={onReorder} />);
    const cards = container.querySelectorAll('.card');
    // jsdom 无真实布局, 手工给末卡 R-3 一个几何: 中线在 y=220
    (cards[2] as HTMLElement).getBoundingClientRect = () =>
      ({ top: 200, height: 40, bottom: 240, left: 0, right: 0, width: 0, x: 0, y: 200, toJSON() {} }) as DOMRect;
    fireEvent.dragStart(cards[0]); // 拖起 R-1
    fireEvent.dragOver(cards[2]);
    // fireEvent 对 drop 事件不透传 clientY, 手工建事件并显式挂 clientY(落在 R-3 下半, 230 > 中线 220)
    const dropEvt = createEvent.drop(cards[2]);
    Object.defineProperty(dropEvt, 'clientY', { value: 230 });
    fireEvent(cards[2], dropEvt); // → R-1 插到 R-3 之后 = 末位
    expect(onReorder).toHaveBeenCalledWith(['R-2', 'R-3', 'R-1']);
  });
});
