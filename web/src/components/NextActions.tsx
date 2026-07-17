import { useState } from 'react';
import type { Actor, TaskState, Hold } from '../types';
import { actionsFor, type TaskAction, type ActInput } from '../actions';

// 「下一步」面板: 取代原来的「换手」三元组表单。
// - 只列当前状态允许的去向, 每条是一句大白话 + 后果 → 拼不出非法组合
// - **默认按规则自动流转**: 交给谁由后端路由表决定(最近谁在扮演那个角色就还派给谁), 按钮上直接写明交给谁,
//   不用每次手选。想改人 → 那正是「换个人做」这个动作的用途(点开才出选择器, 常见路径保持一键)
// - **带内容的动作点开先展开输入区**(计划/产出/理由): 内容和动作同址 —— "提交计划"却没处写计划,
//   动作就是空话。展开区预填现有内容, 改完一并提交。
// - 主动作只有一个; 点击后禁用 + 「处理中…」防连点
export function NextActions({ taskId, state, hold, currentActor, actorsById, routing, content, openSubtasks, onAct }: {
  taskId: string; state: TaskState; hold: Hold; currentActor: string | null;
  actorsById: Record<string, Actor>;
  routing: Record<string, { actorId: string | null; basis: 'history' | 'fallback' }>;
  content: { planMd: string | null; outputsMd: string | null; summary: string | null }; // 表单预填: 已写过的别让人重打
  openSubtasks: number; // 未完成的直接子任务数 —— 完成前必须清零(硬闸在后端), 进测试只如实提示
  onAct: (input: ActInput, action: TaskAction) => Promise<boolean>;
}) {
  const actions = actionsFor(state, hold);
  const agents = Object.values(actorsById).filter((a) => a.type === 'agent');
  const human = Object.values(actorsById).find((a) => a.type === 'human');
  const fallback = agents[0]?.id ?? Object.keys(actorsById)[0] ?? '';
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [openFor, setOpenFor] = useState<string | null>(null); // 哪个动作的面板展开着(换人选择器/内容表单)
  const [picked, setPicked] = useState('');
  const [planV, setPlanV] = useState('');
  const [outV, setOutV] = useState('');
  const [sumV, setSumV] = useState('');
  const [reasonV, setReasonV] = useState('');
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

  // 展开某动作的面板, 预填现有内容(改计划/补产出都是在已有基础上写, 别让人从零重打)
  const openPanel = (a: TaskAction) => {
    if (a.key === 'reassign') setPicked(candidates[0]?.id ?? '');
    else if (a.form?.kind === 'plan') setPlanV(content.planMd ?? '');
    else if (a.form?.kind === 'output') { setOutV(content.outputsMd ?? ''); setSumV(content.summary ?? ''); }
    else if (a.form?.kind === 'reason') setReasonV(note); // 共用留言框里已写的话接过来, 别丢
    setOpenFor(a.key);
  };

  const run = async (a: TaskAction, extra?: Partial<ActInput> & { toActor?: string }) => {
    if (busy) return;
    setBusy(a.key);
    try {
      const ok = await onAct({
        taskId, toActor: extra?.toActor ?? targetOf(a), toRole: a.toRole, toState: a.toState, toHold: a.toHold,
        note: (extra?.note ?? note).trim(), planMd: extra?.planMd, outputs: extra?.outputs,
      }, a);
      if (ok) { setNote(''); setOpenFor(null); } // 失败别抹掉人家写好的内容
    } finally { setBusy(null); }
  };

  // 必填校验: "提交计划"却没有计划、"交去测试"却没说做了什么, 是自相矛盾 —— 空着就不给确认
  const formReady = (a: TaskAction): boolean => {
    if (!a.form?.required) return true;
    if (a.form.kind === 'plan') return planV.trim().length > 0;
    if (a.form.kind === 'output') return outV.trim().length > 0 || sumV.trim().length > 0;
    return true;
  };

  const reasonOpen = actions.some((a) => a.form?.kind === 'reason' && openFor === a.key);

  return (
    <div className="next-actions" aria-busy={!!busy}>
      <div className="act-list">
        {actions.map((a) => {
          const isPick = a.key === 'reassign';
          const target = targetOf(a);
          const who = actorsById[target]?.name;
          // 父子最小不变量(方案 B): 完成的任务不能有没完成的子 —— 收官类动作禁用并说明原因(后端同拦);
          // 进测试不拦, 但把"还有几个没完成"如实摆在按钮上
          const blockedByChildren = a.toState === 'done' && openSubtasks > 0;
          // 按钮第二行直接写明后果 + 交给谁 —— 默认可见, 才谈得上"默认规则"而不是黑箱
          const sub = blockedByChildren ? `还有 ${openSubtasks} 个子任务未完成 —— 全完成才能收官`
            : isPick ? a.hint
              : `${a.hint}${!a.keepActor && who ? ` · 交给 ${who}${isGuess(a) ? '(还没人做过这个角色, 先随便派的)' : ''}` : ''}${a.toState === 'testing' && openSubtasks > 0 ? ` · 还有 ${openSubtasks} 个子任务未完成` : ''}`;
          if (isPick && openFor === a.key) {
            return (
              <div key={a.key} className="reassign-open">
                {candidates.length === 0 && <span className="act-hint">没有别人可换 —— 先注册一个行动者</span>}
                <label className="assign">
                  <span className="assign-label">交给</span>
                  <select autoFocus value={pickedValid} onChange={(e) => setPicked(e.target.value)}>
                    {candidates.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
                  </select>
                </label>
                <button type="button" className="btn primary" disabled={!!busy || !pickedValid} onClick={() => run(a, { toActor: pickedValid })}>确定</button>
                <button type="button" className="btn" disabled={!!busy} onClick={() => setOpenFor(null)}>取消</button>
              </div>
            );
          }
          if (a.form && openFor === a.key) {
            const f = a.form;
            return (
              <div key={a.key} className="act-form" role="group" aria-label={f.title}>
                <div className="act-form-title">{f.title}</div>
                {f.kind === 'plan' && (
                  <textarea autoFocus rows={5} value={planV} onChange={(e) => setPlanV(e.target.value)}
                    placeholder={'- [ ] 第一步…\n- [ ] 第二步…'} />
                )}
                {f.kind === 'output' && (
                  <>
                    <textarea autoFocus rows={4} value={outV} onChange={(e) => setOutV(e.target.value)}
                      placeholder={'- 产物文件/链接…'} />
                    <input value={sumV} onChange={(e) => setSumV(e.target.value)} placeholder="一句话摘要(验收的人先看这个)" />
                  </>
                )}
                {f.kind === 'reason' && (
                  <input autoFocus value={reasonV} onChange={(e) => setReasonV(e.target.value)} placeholder="一句话说清楚, 给接手的人指路" />
                )}
                {f.hint && <div className="act-form-hint">{f.hint}</div>}
                <div className="act-form-btns">
                  <button type="button" className={`btn${a.danger ? ' danger-solid' : ' primary'}`}
                    disabled={!!busy || !formReady(a)}
                    onClick={() => run(a, f.kind === 'plan' ? { planMd: planV }
                      : f.kind === 'output' ? { outputs: { outputsMd: outV, summary: sumV } }
                        : { note: reasonV })}>
                    {busy === a.key ? '处理中…' : a.label}
                  </button>
                  <button type="button" className="btn" disabled={!!busy} onClick={() => setOpenFor(null)}>取消</button>
                </div>
              </div>
            );
          }
          // onlyIfMissing 表单 = 入门守卫: 内容已有就一键直走, 缺了才展开要求写(如"开始执行"的计划)
          const guardPassed = a.form?.onlyIfMissing && (
            a.form.kind === 'plan' ? !!content.planMd?.trim()
              : a.form.kind === 'output' ? !!(content.outputsMd?.trim() || content.summary?.trim())
                : true);
          return (
            // 可及名只取 label: label+hint 会糊成"提交计划, 等我确认先过你这关再开工"这种病句
            <button key={a.key} type="button" aria-label={blockedByChildren ? `${a.label}(还有 ${openSubtasks} 个子任务未完成)` : a.label}
              className={`btn act${a.primary ? ' primary' : ''}${a.danger ? ' danger' : ''}`}
              disabled={!!busy || blockedByChildren} onClick={() => {
                if (isPick || (a.form && !guardPassed)) openPanel(a); // 带面板的动作: 点开才展开(常见路径保持一键)
                else run(a);
              }}>
              <span className="act-label" aria-hidden="true">{busy === a.key ? '处理中…' : a.label}</span>
              <span className="act-hint" aria-hidden="true">{sub}</span>
            </button>
          );
        })}
      </div>
      {/* 理由面板展开时收起共用留言框: 两个"说明"输入同屏必然让人犯嘀咕该填哪个 */}
      {!reasonOpen && (
        <input className="act-note" placeholder="附一句说明(可选)" value={note}
          onChange={(e) => setNote(e.target.value)} disabled={!!busy} />
      )}
    </div>
  );
}
