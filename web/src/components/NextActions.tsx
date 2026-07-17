import { useState } from 'react';
import type { Actor, TaskState, Role } from '../types';
import { NEXT_ACTIONS, type TaskAction } from '../actions';

// 「下一步」面板: 取代原来的「换手」三元组表单。
// - 只列当前状态允许的去向, 每条是一句大白话 + 后果 → 拼不出非法组合
// - **默认按规则自动流转**: 交给谁由后端路由表决定(最近谁在扮演那个角色就还派给谁), 按钮上直接写明交给谁,
//   不用每次手选。想改人 → 那正是「换个人做」这个动作的用途(点开才出选择器, 常见路径保持一键)
// - 主动作只有一个; 点击后禁用 + 「处理中…」防连点
export function NextActions({ taskId, state, currentActor, actorsById, routing, onAct }: {
  taskId: string; state: TaskState; currentActor: string | null;
  actorsById: Record<string, Actor>;
  routing: Record<string, { actorId: string | null; basis: 'history' | 'fallback' }>;
  onAct: (input: { taskId: string; toActor: string; toRole: Role; toState: TaskState; note: string }, action: TaskAction) => Promise<boolean>;
}) {
  const actions = NEXT_ACTIONS[state];
  const agents = Object.values(actorsById).filter((a) => a.type === 'agent');
  const human = Object.values(actorsById).find((a) => a.type === 'human');
  const fallback = agents[0]?.id ?? Object.keys(actorsById)[0] ?? '';
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [pickFor, setPickFor] = useState<string | null>(null); // 正在给哪个动作选人
  const [picked, setPicked] = useState('');
  // 换人的候选: 排除当前行动者(换人不该换成他自己)
  const candidates = Object.values(actorsById).filter((x) => x.id !== currentActor);
  // 双保险: picked 必须真在候选里才作数 —— 否则 <select> 会回退显示第一项, 而 state 仍持旧值,
  // 造成"你看到的人"和"提交的人"是两个人(静默的错误动作)。组件已按任务 key 重挂, 这里再兜一层。
  const pickedValid = candidates.some((x) => x.id === picked) ? picked : (candidates[0]?.id ?? '');

  if (actions.length === 0) return null;

  // 谁来接手。三条互斥的意图, 不能混:
  // toHuman=交到你手里(用 keepActor 冒充会把当前 agent 设成决策者) / keepActor=留在原处 / 其余=按角色路由
  const targetOf = (a: TaskAction): string =>
    a.toHuman ? (human?.id ?? fallback)
      : a.keepActor ? (currentActor ?? fallback)
        : (routing[a.toRole]?.actorId ?? currentActor ?? fallback);
  // 这个默认是"按最近分工推出的"还是"没人干过, 随便挑的"? 后者要如实说, 别装成有规则
  const isGuess = (a: TaskAction) => !a.toHuman && !a.keepActor && routing[a.toRole]?.basis === 'fallback';

  const run = async (a: TaskAction, actorOverride?: string) => {
    if (busy) return;
    setBusy(a.key);
    try {
      const ok = await onAct({ taskId, toActor: actorOverride ?? targetOf(a), toRole: a.toRole, toState: a.toState, note: note.trim() }, a);
      if (ok) { setNote(''); setPickFor(null); } // 失败别抹掉人家写好的说明
    } finally { setBusy(null); }
  };

  return (
    <div className="next-actions" aria-busy={!!busy}>
      <div className="act-list">
        {actions.map((a) => {
          const isPick = a.key === 'reassign';
          const target = targetOf(a);
          const who = actorsById[target]?.name;
          // 按钮第二行直接写明后果 + 交给谁 —— 默认可见, 才谈得上"默认规则"而不是黑箱
          const sub = isPick ? a.hint
            : `${a.hint}${!a.keepActor && who ? ` · 交给 ${who}${isGuess(a) ? '(还没人做过这个角色, 先随便派的)' : ''}` : ''}`;
          if (isPick && pickFor === a.key) {
            return (
              <div key={a.key} className="reassign-open">
                {candidates.length === 0 && <span className="act-hint">没有别人可换 —— 先注册一个行动者</span>}
                <label className="assign">
                  <span className="assign-label">交给</span>
                  <select autoFocus value={pickedValid} onChange={(e) => setPicked(e.target.value)}>
                    {candidates.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
                  </select>
                </label>
                <button type="button" className="btn primary" disabled={!!busy || !pickedValid} onClick={() => run(a, pickedValid)}>确定</button>
                <button type="button" className="btn" disabled={!!busy} onClick={() => setPickFor(null)}>取消</button>
              </div>
            );
          }
          return (
            // 可及名只取 label: label+hint 会糊成"提交计划, 等我确认先过你这关再开工"这种病句
            <button key={a.key} type="button" aria-label={a.label}
              className={`btn act${a.primary ? ' primary' : ''}${a.danger ? ' danger' : ''}`}
              disabled={!!busy} onClick={() => {
                if (isPick) { setPicked(candidates[0]?.id ?? ''); setPickFor(a.key); } // 手动换人: 点开才出选择器
                else run(a);
              }}>
              <span className="act-label" aria-hidden="true">{busy === a.key ? '处理中…' : a.label}</span>
              <span className="act-hint" aria-hidden="true">{sub}</span>
            </button>
          );
        })}
      </div>
      <input className="act-note" placeholder="附一句说明(可选)" value={note}
        onChange={(e) => setNote(e.target.value)} disabled={!!busy} />
    </div>
  );
}
