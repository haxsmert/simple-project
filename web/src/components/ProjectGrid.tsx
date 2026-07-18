import type { ReactNode } from 'react';
import type { BoardCard, Actor } from '../types';
import { ActorBadge } from './ActorBadge';
import { STATE_NAME, STATE_COLOR } from '../states';

// 项目总览 = 项目层透镜(2026-07-18)。此前根视图复用任务看板的四阶段 kanban, 和下钻后的任务看板
// 长得一模一样, 读起来像"任务看板的复制品"—— 而四阶段对"整个项目"几乎没信息量(项目这个顶层任务
// 多半永远停在"待规划", 大家推的是它的子任务)。
// 项目这一层真正要回答的是: **我该关心哪个项目** —— 进度到哪、有没有活卡着我。
// 故弃四列, 改项目卡网格, 每张卡把两件事做大: 进度环(子任务完成度) + 🔔 待你处理(挂起任务数)。
// 排序也让需要你的项目冒头(见 App 的 projectList)。点卡即钻入它的任务看板(那一层四阶段才是对的)。

function Ring({ pct }: { pct: number }) {
  const r = 20.5;
  const c = 2 * Math.PI * r;
  const off = c * (1 - pct / 100);
  return (
    <svg className="ring" viewBox="0 0 46 46" width="46" height="46" aria-hidden="true">
      <circle cx="23" cy="23" r={r} className="ring-track" />
      <circle cx="23" cy="23" r={r} className="ring-fill" strokeDasharray={c} strokeDashoffset={off}
        transform="rotate(-90 23 23)" style={pct === 100 ? { stroke: 'var(--done)' } : undefined} />
      <text x="23" y="23" className="ring-num">{pct}%</text>
    </svg>
  );
}

export function ProjectGrid({ projects, actorsById, onOpen, emptyHint }: {
  projects: BoardCard[]; actorsById: Record<string, Actor>;
  onOpen: (id: string) => void; emptyHint?: ReactNode;
}) {
  if (projects.length === 0 && emptyHint) return <div className="board-empty">{emptyHint}</div>;
  return (
    <div className="pgrid">
      {projects.map((p) => {
        const total = p.subtaskCount ?? 0;
        const done = p.doneSubtaskCount ?? 0;
        const pct = total ? Math.round((done / total) * 100) : 0;
        const attn = p.attention ?? 0;
        const actor = p.currentActor ? actorsById[p.currentActor] ?? null : null;
        // 卡面降噪的信号(状态/进度/待处理数)完整留给读屏
        const label = [
          p.title, STATE_NAME[p.state], total ? `进度 ${done}/${total}` : '暂无子任务',
          attn ? `${attn} 项待你处理` : '', p.id,
        ].filter(Boolean).join(' · ');
        return (
          <div key={p.id} className={`pcard${attn > 0 ? ' needs' : ''}`} onClick={() => onOpen(p.id)}>
            <div className="pcard-head">
              <span className="pstate"><span className="pdot" style={{ background: STATE_COLOR[p.state] }} />{STATE_NAME[p.state]}</span>
              {attn > 0 && <span className="attn-pill sm">🔔 {attn} 待你处理</span>}
            </div>
            <div className="pcard-body">
              {total > 0
                ? <Ring pct={pct} />
                : <span className="ring ring-empty" aria-hidden="true">—</span>}
              {/* 标题即"钻入项目"按钮: 卡片整体可点, 键盘/读屏走这个真按钮 */}
              <button type="button" className="pcard-title" aria-label={label}
                onClick={(e) => { e.stopPropagation(); onOpen(p.id); }}>{p.title}</button>
            </div>
            <div className="pcard-foot">
              <ActorBadge actor={actor} />
              <span className="pcard-meta">
                <span className="psub">{total ? `子任务 ${done}/${total}` : '无子任务'}</span>
                <span className="card-id">{p.id}</span>
              </span>
            </div>
          </div>
        );
      })}
    </div>
  );
}
