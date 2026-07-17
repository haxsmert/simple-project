import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, within, createEvent } from '@testing-library/react';
import { Board, reorderIds } from './Board';
import type { BoardColumn } from '../types';

const columns: BoardColumn[] = [
  { state: 'executing', tasks: [{ id: 'R-1', title: '搭建数据层', state: 'executing', currentActor: 'a', currentRole: 'executor', parentId: null, goal: null, inputsMd: null, outputsMd: null, summary: null, priority: 'hi' }] },
  { state: 'awaiting_decision', tasks: [{ id: 'R-2', title: '要不要富文本', state: 'awaiting_decision', currentActor: 'you', currentRole: 'decider', parentId: null, goal: null, inputsMd: null, outputsMd: null, summary: null, priority: 'hi' }] },
  { state: 'planning', tasks: [] }, { state: 'awaiting_confirm', tasks: [] }, { state: 'testing', tasks: [] }, { state: 'done', tasks: [] },
];
const actors = { a: { id: 'a', name: '执行A', type: 'agent' as const, handle: null }, you: { id: 'you', name: '你', type: 'human' as const, handle: null } };

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

  it('卡片渲染优先级标记 / 子任务进度 / 关系边 chip(BoardCard 富化字段)', () => {
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
    expect(container.querySelector('.edge.dep')).toBeTruthy(); // 依赖关系边 chip
  });

  it('待确认子任务卡片(clarifies 出边)只显示"待决策"阻塞 chip, 不重复渲染"待确认"边 chip', () => {
    const clarColumns: BoardColumn[] = [
      {
        state: 'awaiting_decision',
        tasks: [{
          id: 'R-148', title: '待确认: 要不要富文本?', state: 'awaiting_decision', currentActor: 'you', currentRole: 'decider',
          parentId: 'R-142', goal: null, inputsMd: null, outputsMd: null, summary: null, priority: 'hi',
          edges: { out: [{ id: 'e2', fromTask: 'R-148', toTask: 'R-142', type: 'clarifies' }], in: [] },
        }],
      },
    ];
    const { container } = render(<Board columns={clarColumns} actorsById={actors} onOpen={vi.fn()} />);
    const card = container.querySelector('.card') as HTMLElement;
    expect(within(card).getByText('待决策')).toBeInTheDocument();
    expect(within(card).queryAllByText('待确认').length).toBe(0);
    expect(card.querySelectorAll('.edge').length).toBe(1); // 仅阻塞 chip 本身, 无重复的 clarifies 边 chip
  });

  it('卡片带 parentTitle 时渲染 .card-project 项目名; 不带 parentTitle 时不渲染', () => {
    const projTitleColumns: BoardColumn[] = [
      {
        state: 'executing',
        tasks: [
          {
            id: 'R-80', title: '带项目名的任务', state: 'executing', currentActor: 'a', currentRole: 'executor',
            parentId: 'R-79', goal: null, inputsMd: null, outputsMd: null, summary: null, priority: 'hi',
            parentTitle: '演示项目',
          },
          {
            id: 'R-81', title: '无项目名的任务', state: 'executing', currentActor: 'a', currentRole: 'executor',
            parentId: null, goal: null, inputsMd: null, outputsMd: null, summary: null, priority: 'hi',
          },
        ],
      },
      { state: 'awaiting_decision', tasks: [] }, { state: 'planning', tasks: [] },
      { state: 'awaiting_confirm', tasks: [] }, { state: 'testing', tasks: [] }, { state: 'done', tasks: [] },
    ];
    const { container } = render(<Board columns={projTitleColumns} actorsById={actors} onOpen={vi.fn()} />);
    const cards = container.querySelectorAll('.card');
    expect(within(cards[0] as HTMLElement).getByText('演示项目')).toBeInTheDocument();
    expect(cards[0].querySelector('.card-project')).toBeTruthy();
    expect(cards[1].querySelector('.card-project')).toBeFalsy();
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

  it('待确认卡片显示「待你确认」标记; 项目卡 attention 渲染「N 待处理」', () => {
    const cols: BoardColumn[] = [
      { state: 'awaiting_confirm', tasks: [{ id: 'R-3', title: '计划待确认', state: 'awaiting_confirm', currentActor: 'a', currentRole: 'decider', parentId: 'R-1', goal: null, inputsMd: null, outputsMd: null, summary: null, priority: null }] },
      { state: 'planning', tasks: [{ id: 'R-1', title: '项目A', state: 'planning', currentActor: null, currentRole: null, parentId: null, goal: null, inputsMd: null, outputsMd: null, summary: null, priority: null, attention: 2 }] },
      { state: 'awaiting_decision', tasks: [] }, { state: 'executing', tasks: [] }, { state: 'testing', tasks: [] }, { state: 'done', tasks: [] },
    ];
    render(<Board columns={cols} actorsById={actors} onOpen={vi.fn()} />);
    expect(screen.getByText('待你确认')).toBeInTheDocument();   // 待确认卡标记
    expect(screen.getByText('2 待处理')).toBeInTheDocument();    // 项目卡统一为"待处理"(含待确认+待决策)
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
