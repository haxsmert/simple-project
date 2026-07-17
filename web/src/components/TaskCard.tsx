import { useEffect, useRef, type DragEvent } from 'react';
import type { BoardCard, Actor, TaskState } from '../types';
import { ActorBadge } from './ActorBadge';
import { STATE_NAME, HOLD_FLAG } from '../states';

// 卡面刻意克制(2026-07-17 去杂乱约定): 状态由所在列 + 琥珀底色承载, 不再挂状态 chip;
// 角色/关系边归详情抽屉; 项目名只在跨项目的"全部任务"视图显示(单项目视图里每张卡重复同一项目名=纯噪声)。
// 读屏不受降噪影响: aria-label 完整携带 项目/状态/待处理数/优先级。
const PRIO_LABEL: Record<'hi' | 'mid' | 'lo', string> = { hi: '高', mid: '中', lo: '低' };

export function TaskCard({ task, actor, onOpen, onDescend, showProject, flash, draggable, dragging, onDragStart, onDragOver, onDrop, onDragEnd }: {
  task: BoardCard; actor: Actor | null; onOpen: (id: string) => void;
  onDescend?: (id: string) => void; // 提供时: 「子任务 N/M」变成"钻入"入口, 下钻到该任务的子任务层
  showProject?: boolean; // 仅跨项目视图(全部任务)展示所属项目名
  flash?: boolean;       // 刚被动作影响 → 亮一下
  draggable?: boolean; dragging?: boolean;
  onDragStart?: (e: DragEvent<HTMLDivElement>) => void; onDragOver?: (e: DragEvent<HTMLDivElement>) => void;
  onDrop?: (e: DragEvent<HTMLDivElement>) => void; onDragEnd?: (e: DragEvent<HTMLDivElement>) => void;
}) {
  // 挂起 = 原地举手: 任务留在自己的阶段列, 靠整卡琥珀底 + 「待你确认/待你决策」徽标招手
  // (挂起不再是列 —— 列头没法替它说话, 卡面必须自己说, 且不靠颜色单独传意)
  const needsYou = task.hold !== null;

  const subtaskCount = task.subtaskCount ?? 0;
  const hasSubtasks = subtaskCount > 0;
  const doneSubtaskCount = task.doneSubtaskCount ?? 0;
  const pct = hasSubtasks ? Math.round((doneSubtaskCount / subtaskCount) * 100) : 0;

  // 可及名把卡面降噪掉的关键信号(所属项目/状态/待你处理数/优先级)完整保留给读屏
  // 动作完成后抽屉会关掉, 原触发卡已随重渲染换成新 DOM 节点(旧 ref 失效 → 焦点掉回 body)。
  // 由"刚被动作影响、正在高亮"的这张卡接住焦点 —— 它就是你刚操作的那张, 键盘不断链。
  const titleRef = useRef<HTMLButtonElement>(null);
  useEffect(() => { if (flash) titleRef.current?.focus(); }, [flash]);

  const a11yLabel = [
    showProject ? task.parentTitle : null, task.title, STATE_NAME[task.state],
    task.hold ? HOLD_FLAG[task.hold] : '',
    task.attention ? `${task.attention} 项待你处理` : '',
    task.priority ? `优先级${PRIO_LABEL[task.priority]}` : '',
    task.id,
  ].filter(Boolean).join(' · ');

  return (
    <div className={`card${needsYou ? ' blocked' : ''}${dragging ? ' dragging' : ''}${flash ? ' flash' : ''}`} onClick={() => onOpen(task.id)}
      draggable={draggable} onDragStart={onDragStart} onDragOver={onDragOver} onDrop={onDrop} onDragEnd={onDragEnd}>
      {showProject && task.parentTitle && <div className="card-project">{task.parentTitle}</div>}
      {(task.hold || (!!task.attention && task.attention > 0)) && (
        <div className="card-top">
          {task.hold && <span className="attn-chip">{HOLD_FLAG[task.hold]}</span>}
          {!!task.attention && task.attention > 0 && <span className="attn-chip">{task.attention} 待处理</span>}
        </div>
      )}
      {/* 标题即"打开详情"按钮: 卡片本体是普通容器(鼠标点任意处也打开), 键盘/读屏走这个真按钮, 不嵌套交互 */}
      <button ref={titleRef} type="button" className="card-title" aria-label={a11yLabel} onClick={(e) => { e.stopPropagation(); onOpen(task.id); }}>{task.title}</button>
      {hasSubtasks && (onDescend ? (
        <button type="button" className="sub-mini sub-drill" title="钻入子任务"
          onClick={(e) => { e.stopPropagation(); onDescend(task.id); }}>
          <span className="bar"><i style={{ width: `${pct}%` }} /></span>
          子任务 {doneSubtaskCount}/{subtaskCount}
          <span className="drill">钻入 ›</span>
        </button>
      ) : (
        <div className="sub-mini">
          <span className="bar"><i style={{ width: `${pct}%` }} /></span>
          子任务 {doneSubtaskCount}/{subtaskCount}
        </div>
      ))}
      <div className="card-foot">
        <ActorBadge actor={actor} />
        <span className="card-meta">
          {task.priority && <span className={`prio ${task.priority}`} title={`优先级 ${PRIO_LABEL[task.priority]}`}>{PRIO_LABEL[task.priority]}</span>}
          <span className="card-id">{task.id}</span>
        </span>
      </div>
    </div>
  );
}
