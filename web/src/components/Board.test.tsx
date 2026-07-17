import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, within, createEvent } from '@testing-library/react';
import { Board, reorderIds } from './Board';
import type { BoardColumn } from '../types';

const columns: BoardColumn[] = [
  { state: 'executing', tasks: [{ id: 'R-1', title: '搭建数据层', state: 'executing', currentActor: 'a', currentRole: 'executor', parentId: null, goal: null, inputsMd: null, outputsMd: null, summary: null, priority: 'hi' }] },
  { state: 'awaiting_decision', tasks: [{ id: 'R-2', title: '要不要富文本', state: 'awaiting_decision', currentActor: 'admin', currentRole: 'decider', parentId: null, goal: null, inputsMd: null, outputsMd: null, summary: null, priority: 'hi' }] },
  { state: 'planning', tasks: [] }, { state: 'awaiting_confirm', tasks: [] }, { state: 'testing', tasks: [] }, { state: 'done', tasks: [] },
];
const actors = { a: { id: 'a', name: '执行A', type: 'agent' as const, handle: null }, admin: { id: 'admin', name: 'admin', type: 'human' as const, handle: null } };

// 同一列(executing)下 3 张卡片, 专供拖拽排序测试使用
const dragColumns: BoardColumn[] = [
  {
    state: 'executing',
    tasks: (['R-1', 'R-2', 'R-3'] as const).map((id, i) => ({
      id, title: `任务${i + 1}`, state: 'executing', currentActor: 'a', currentRole: 'executor',
      parentId: null, goal: null, inputsMd: null, outputsMd: null, summary: null, priority: 'hi',
    })),
  },
  { state: 'awaiting_decision', tasks: [] }, { state: 'planning', tasks: [] },
  { state: 'awaiting_confirm', tasks: [] }, { state: 'testing', tasks: [] }, { state: 'done', tasks: [] },
];

describe('Board', () => {
  it('渲染卡片, 待决策列高亮, 点击回调', () => {
    const onOpen = vi.fn();
    const { container } = render(<Board columns={columns} actorsById={actors} onOpen={onOpen} />);
    expect(screen.getByText('搭建数据层')).toBeInTheDocument();
    expect(container.querySelector('.col.attn')).toBeTruthy(); // 待决策列
    expect(container.querySelector('.card.blocked')).toBeTruthy(); // R-2 卡
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

  it('卡面降噪: 优先级「高」保留红徽标, 子任务进度保留, 关系边/角色/状态 chip 一律不上卡面(归详情与列头)', () => {
    const richColumns: BoardColumn[] = [
      {
        state: 'executing',
        tasks: [{
          id: 'R-20', title: '带富化信息的卡片', state: 'executing', currentActor: 'a', currentRole: 'executor',
          parentId: null, goal: null, inputsMd: null, outputsMd: null, summary: null, priority: 'hi',
          subtaskCount: 5, doneSubtaskCount: 3,
          edges: { out: [{ id: 'e1', fromTask: 'R-20', toTask: 'R-30', type: 'depends_on' }], in: [] },
        }],
      },
      { state: 'awaiting_decision', tasks: [] }, { state: 'planning', tasks: [] },
      { state: 'awaiting_confirm', tasks: [] }, { state: 'testing', tasks: [] }, { state: 'done', tasks: [] },
    ];
    const { container } = render(<Board columns={richColumns} actorsById={actors} onOpen={vi.fn()} />);
    expect(container.querySelector('.prio.hi')).toBeTruthy(); // 优先级标记
    expect(screen.getByText('高')).toBeInTheDocument(); // 用文字承载优先级, 不靠颜色单独传意
    expect(container.querySelector('.sub-mini')).toBeTruthy(); // 子任务进度条
    expect(screen.getByText('子任务 3/5')).toBeInTheDocument();
    expect(container.querySelector('.edge')).toBeNull(); // 关系边不再上卡面(详情抽屉仍有)
    expect(container.querySelector('.role')).toBeNull(); // 角色 chip 不再上卡面
  });

  it('"轮到你"的卡(待决策/待确认)整卡琥珀底色, 状态由列头承载, 卡面无状态 chip; 读屏 aria-label 保留状态', () => {
    const clarColumns: BoardColumn[] = [
      {
        state: 'awaiting_decision',
        tasks: [{
          id: 'R-148', title: '要不要富文本?', state: 'awaiting_decision', currentActor: 'admin', currentRole: 'decider',
          parentId: 'R-142', goal: null, inputsMd: null, outputsMd: null, summary: null, priority: 'hi',
        }],
      },
      {
        state: 'awaiting_confirm',
        tasks: [{
          id: 'R-149', title: '计划待确认的任务', state: 'awaiting_confirm', currentActor: 'admin', currentRole: 'decider',
          parentId: 'R-142', goal: null, inputsMd: null, outputsMd: null, summary: null, priority: null,
        }],
      },
    ];
    const { container } = render(<Board columns={clarColumns} actorsById={actors} onOpen={vi.fn()} />);
    const cards = container.querySelectorAll('.card');
    expect(cards[0].className).toContain('blocked'); // 待决策卡琥珀
    expect(cards[1].className).toContain('blocked'); // 待确认卡也琥珀("轮到你"同语言)
    expect(container.querySelectorAll('.col.attn').length).toBe(2); // 两列列头都亮琥珀
    expect(within(cards[0] as HTMLElement).queryByText('待决策')).toBeNull(); // 卡面不重复列头状态
    expect(within(cards[0] as HTMLElement).getByRole('button', { name: /待决策/ })).toBeInTheDocument(); // 读屏可及名保留状态
  });

  it('项目名只在跨项目视图(showProject)显示; 单项目视图里不重复渲染同一项目名', () => {
    const projTitleColumns: BoardColumn[] = [
      {
        state: 'executing',
        tasks: [{
          id: 'R-80', title: '带项目名的任务', state: 'executing', currentActor: 'a', currentRole: 'executor',
          parentId: 'R-79', goal: null, inputsMd: null, outputsMd: null, summary: null, priority: 'hi',
          parentTitle: '演示项目',
        }],
      },
      { state: 'awaiting_decision', tasks: [] }, { state: 'planning', tasks: [] },
      { state: 'awaiting_confirm', tasks: [] }, { state: 'testing', tasks: [] }, { state: 'done', tasks: [] },
    ];
    const { container: withProj } = render(<Board columns={projTitleColumns} actorsById={actors} onOpen={vi.fn()} showProject />);
    expect(withProj.querySelector('.card-project')?.textContent).toBe('演示项目'); // 全部任务视图: 显示
    const { container: withoutProj } = render(<Board columns={projTitleColumns} actorsById={actors} onOpen={vi.fn()} />);
    expect(withoutProj.querySelector('.card-project')).toBeFalsy(); // 单项目视图: 不重复
  });

  it('提供 onDescend 时「子任务 N/M」变成"钻入"入口, 点击调用 onDescend 且不触发 onOpen(详情)', () => {
    const onOpen = vi.fn(); const onDescend = vi.fn();
    const cols: BoardColumn[] = [
      { state: 'executing', tasks: [{ id: 'R-20', title: '有子任务的任务', state: 'executing', currentActor: 'a', currentRole: 'executor', parentId: null, goal: null, inputsMd: null, outputsMd: null, summary: null, priority: null, subtaskCount: 3, doneSubtaskCount: 1 }] },
      { state: 'awaiting_confirm', tasks: [] }, { state: 'awaiting_decision', tasks: [] }, { state: 'planning', tasks: [] }, { state: 'testing', tasks: [] }, { state: 'done', tasks: [] },
    ];
    render(<Board columns={cols} actorsById={actors} onOpen={onOpen} onDescend={onDescend} />);
    fireEvent.click(screen.getByTitle('钻入子任务'));
    expect(onDescend).toHaveBeenCalledWith('R-20');
    expect(onOpen).not.toHaveBeenCalled(); // 钻入不应顺带打开详情
  });

  it('不提供 onDescend 时「子任务 N/M」是纯展示(无钻入按钮)', () => {
    const cols: BoardColumn[] = [
      { state: 'executing', tasks: [{ id: 'R-20', title: '有子任务的任务', state: 'executing', currentActor: 'a', currentRole: 'executor', parentId: null, goal: null, inputsMd: null, outputsMd: null, summary: null, priority: null, subtaskCount: 3, doneSubtaskCount: 1 }] },
      { state: 'awaiting_confirm', tasks: [] }, { state: 'awaiting_decision', tasks: [] }, { state: 'planning', tasks: [] }, { state: 'testing', tasks: [] }, { state: 'done', tasks: [] },
    ];
    render(<Board columns={cols} actorsById={actors} onOpen={vi.fn()} />);
    expect(screen.queryByTitle('钻入子任务')).toBeNull();
    expect(screen.getByText(/子任务 1\/3/)).toBeInTheDocument();
  });

  it('项目卡 attention 渲染「N 待处理」聚合角标(唯一上卡面的 chip)', () => {
    const cols: BoardColumn[] = [
      { state: 'planning', tasks: [{ id: 'R-1', title: '项目A', state: 'planning', currentActor: null, currentRole: null, parentId: null, goal: null, inputsMd: null, outputsMd: null, summary: null, priority: null, attention: 2 }] },
      { state: 'awaiting_confirm', tasks: [] }, { state: 'awaiting_decision', tasks: [] }, { state: 'executing', tasks: [] }, { state: 'testing', tasks: [] }, { state: 'done', tasks: [] },
    ];
    render(<Board columns={cols} actorsById={actors} onOpen={vi.fn()} />);
    expect(screen.getByText('2 待处理')).toBeInTheDocument(); // 聚合信号非重复信息, 保留
  });

  it('全空看板渲染 board-empty 与提示文案', () => {
    const emptyColumns: BoardColumn[] = ALL_STATES_EMPTY();
    const { container } = render(
      <Board columns={emptyColumns} actorsById={actors} onOpen={vi.fn()}
        emptyHint={<><b>还没有任务</b><div>去追加一个吧</div></>} />
    );
    expect(container.querySelector('.board-empty')).toBeTruthy();
    expect(screen.getByText('还没有任务')).toBeInTheDocument();
    expect(screen.getByText('去追加一个吧')).toBeInTheDocument();
    expect(container.querySelector('.board')).toBeFalsy();
  });

  it('部分列为空时, 空列渲染 col-empty 占位', () => {
    const { container } = render(<Board columns={columns} actorsById={actors} onOpen={vi.fn()} />);
    const cols = container.querySelectorAll('.col');
    // planning/awaiting_confirm/testing/done 列在 fixture 里没有任务
    expect(container.querySelectorAll('.col-empty').length).toBe(4);
    expect(cols.length).toBe(6);
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
    const cardsContainer = container.querySelector('.cards') as HTMLElement;
    fireEvent.dragStart(cards[0]); // 拖起 R-1
    fireEvent.drop(cardsContainer); // 松手在列的空白容器上(未命中任何卡片)
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

function ALL_STATES_EMPTY(): BoardColumn[] {
  return ['planning', 'awaiting_confirm', 'executing', 'awaiting_decision', 'testing', 'done'].map((state) => ({
    state: state as BoardColumn['state'], tasks: [],
  }));
}
