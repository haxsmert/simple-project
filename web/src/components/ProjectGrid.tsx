import type { ReactNode } from 'react';
import type { ProjectCard, ProjectOverview, Actor } from '../types';
import { ActorBadge } from './ActorBadge';
import { eventText, timeAgo } from '../events';

// 项目总览 = 项目层透镜(2026-07-19 定调: 项目=大号任务, 长期/持续/不定期迭代)。
// 项目卡只回答「我该关心哪个项目」: **目标**(它为什么存在) + **🔔待你处理**(有活等我吗)
// + **最近动静**(它还活着吗/谁刚干了什么)。进度百分比对持续追加任务的流是假指标, 已删。
// 两组: 执行中在前(有活等你的冒头, 排序在后端), 已完结折叠沉底当归档。点卡钻入它的任务看板。

function activityLine(c: ProjectCard, nameOf: (id: string | null) => string | null): string {
  const ev = c.lastEvent;
  if (!ev) return '还没动静';
  const verb = eventText(ev, nameOf, { project: ev.taskId === c.id });
  const where = ev.taskId !== c.id ? `「${ev.taskTitle}」` : '';
  const body = ev.body ? `: ${ev.body}` : '';
  return `${ev.actorName} ${verb}${where}${body} · ${timeAgo(ev.createdAt)}`;
}

function Card({ p, actorsById, onOpen, closed }: {
  p: ProjectCard; actorsById: Record<string, Actor>; onOpen: (id: string) => void; closed?: boolean;
}) {
  const attn = p.attention ?? 0;
  const actor = p.currentActor ? actorsById[p.currentActor] ?? null : null;
  const nameOf = (id: string | null) => (id ? actorsById[id]?.name ?? id : null);
  const act = activityLine(p, nameOf);
  // 卡面信号完整留给读屏(状态/目标/待处理数/最近动静)
  const label = [p.title, closed ? '已完结' : '执行中', p.goal ?? '还没写目标', attn ? `${attn} 项待你处理` : '', act, p.id]
    .filter(Boolean).join(' · ');
  return (
    <div className={`pcard${attn > 0 ? ' needs' : ''}${closed ? ' closed' : ''}`} onClick={() => onOpen(p.id)}>
      {(attn > 0 || closed) && (
        <div className="pcard-head">
          {closed && <span className="pclosed-chip">已完结</span>}
          {attn > 0 && <span className="attn-pill sm">🔔 {attn} 待你处理</span>}
        </div>
      )}
      {/* 标题即"钻入项目"按钮: 卡片整体可点, 键盘/读屏走这个真按钮 */}
      <button type="button" className="pcard-title" aria-label={label}
        onClick={(e) => { e.stopPropagation(); onOpen(p.id); }}>{p.title}</button>
      {/* 目标 = 项目为什么存在; 存量项目还没写的如实提示(空着比编内容诚实, 点开详情能补) */}
      <div className={`pcard-goal${p.goal ? '' : ' missing'}`}>{p.goal ?? '还没写目标 —— 点开在详情里补上'}</div>
      {/* 最近动静: 对持续流, "谁刚干了什么/多久没动"比任何百分比诚实 */}
      <div className="pcard-act" title={act}>{act}</div>
      <div className="pcard-foot">
        <ActorBadge actor={actor} />
        <span className="card-id">{p.id}</span>
      </div>
    </div>
  );
}

export function ProjectGrid({ overview, actorsById, onOpen, emptyHint }: {
  overview: ProjectOverview; actorsById: Record<string, Actor>;
  onOpen: (id: string) => void; emptyHint?: ReactNode;
}) {
  const { active, closed } = overview;
  if (active.length === 0 && closed.length === 0 && emptyHint) return <div className="board-empty">{emptyHint}</div>;
  return (
    <div>
      {active.length > 0
        ? <div className="pgrid">{active.map((p) => <Card key={p.id} p={p} actorsById={actorsById} onOpen={onOpen} />)}</div>
        : <div className="board-empty"><b>没有执行中的项目</b><div>点右上角「+ 新建项目」开一个方向</div></div>}
      {closed.length > 0 && (
        <details className="closed-sec">
          <summary>已完结 {closed.length}</summary>
          <div className="pgrid">{closed.map((p) => <Card key={p.id} p={p} actorsById={actorsById} onOpen={onOpen} closed />)}</div>
        </details>
      )}
    </div>
  );
}
