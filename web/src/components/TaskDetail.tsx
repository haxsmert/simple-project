import { useState, useEffect, useRef } from 'react';
import type { TaskPackage, Actor, TaskState, Role, Task, TaskEvent } from '../types';
import { ActorBadge } from './ActorBadge';
import { RoleChip } from './RoleChip';
import { EdgeChip } from './EdgeChip';
import { STATE_NAME, STATE_COLOR } from '../states';
import { NextActions } from './NextActions';
import { NEXT_ACTIONS, type TaskAction } from '../actions';

const STATE_PILL: Record<TaskState, string> = { planning: 'plan', awaiting_confirm: 'confirm', executing: 'exec', awaiting_decision: 'decide', testing: 'test', done: 'done' };
const ROLE_NAME: Record<Role, string> = { planner: '规划', executor: '执行', tester: '测试', questioner: '提问', decider: '决策' };
// 「经过」里显示给人看的动词: 说人话, 不用协议名/比喻。(事件 kind 是协议内部名, 不动)
const KIND_VERB: Record<string, string> = {
  handoff: '交给了下一个人', comment: '留言', output: '交了产出', clarify: '提了个问题等人决定', decide: '拍了板', claim: '接手',
};

// ——— 图标(照搬 mockup 的 inline SVG) ———
const IconFile = () => (
  <svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden focusable="false">
    <path d="M9 2H4v12h8V5z" /><path d="M9 2v3h3" />
  </svg>
);
const IconOutputs = () => (
  <svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden focusable="false">
    <path d="M8 2v8M4.5 6.5L8 10l3.5-3.5" /><path d="M2.5 13h11" />
  </svg>
);
const IconQuestion = () => (
  <svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden focusable="false">
    <path d="M6 6a2 2 0 113 1.7c-.7.4-1 .8-1 1.6" /><circle cx="8" cy="12" r=".7" fill="currentColor" stroke="none" />
  </svg>
);
const IconWarnTriangle = () => (
  <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden focusable="false">
    <path d="M8 1.5L15 14H1z" /><path d="M8 6.5v3.2" /><circle cx="8" cy="11.6" r=".6" fill="currentColor" stroke="none" />
  </svg>
);
const IconThread = () => (
  <svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden focusable="false">
    <path d="M2 4.5A1.5 1.5 0 013.5 3h9A1.5 1.5 0 0114 4.5v5A1.5 1.5 0 0112.5 11H6l-3 2.5V11H3.5A1.5 1.5 0 012 9.5z" />
  </svg>
);
const IconHandoff = () => (
  <svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden focusable="false">
    <path d="M2 8h9M8 4.5L11.5 8 8 11.5" /><path d="M14 4v8" />
  </svg>
);
const IconArrowRight = () => (
  <svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden focusable="false">
    <path d="M2 8h11M9 4.5L12.5 8 9 11.5" />
  </svg>
);
const IconCheck = () => (
  <svg viewBox="0 0 12 12" width="9" height="9" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden focusable="false">
    <path d="M2.5 6.5l2.5 2.5 4.5-5" />
  </svg>
);
const IconPencil = () => (
  <svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden focusable="false">
    <path d="M11.5 2.5l2 2L5 13l-3 .5.5-3z" />
  </svg>
);
const IconChecklist = () => (
  <svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" aria-hidden focusable="false">
    <path d="M3 4h1M3 8h1M3 12h1" /><path d="M6.5 4h7M6.5 8h7M6.5 12h7" />
  </svg>
);
const IconLink = () => (
  <svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden focusable="false">
    <path d="M6.5 9.5l3-3" /><path d="M7 4.5l1-1a2.5 2.5 0 013.5 3.5l-1 1" /><path d="M9 11.5l-1 1a2.5 2.5 0 01-3.5-3.5l1-1" />
  </svg>
);

// 槽位标题: 只用大白话中文。英文副标题(Inputs/Outputs/Handoff/Thread)是纯装饰, 对使用者零信息量, 已撤。
function SlotHead({ icon, tint, title, tag }: { icon: React.ReactNode; tint: 'human' | 'agent' | 'warn' | 'neutral'; title: string; tag?: string }) {
  return (
    <div className="slot-head">
      <span className={`ico ${tint}`}>{icon}</span>
      <h4>{title}</h4>
      {tag && <span className="tag">{tag}</span>}
    </div>
  );
}

// ——— 数据解析(inputsMd / outputsMd / goal 里的 markdown 片段) ———
function parsePlan(md: string | null): { plain: string[]; items: { done: boolean; text: string }[] } {
  const plain: string[] = [];
  const items: { done: boolean; text: string }[] = [];
  if (!md) return { plain, items };
  for (const raw of md.split('\n')) {
    const line = raw.trim();
    if (!line) continue;
    const m = /^- \[( |x)\] (.*)$/.exec(line);
    if (m) items.push({ done: m[1] === 'x', text: m[2] });
    else plain.push(line);
  }
  return { plain, items };
}

function parseArtifacts(md: string | null): { plain: string[]; files: string[] } {
  const plain: string[] = [];
  const files: string[] = [];
  if (!md) return { plain, files };
  for (const raw of md.split('\n')) {
    const line = raw.trim();
    if (!line) continue;
    if (line.startsWith('- ')) files.push(line.slice(2).trim());
    else plain.push(line);
  }
  return { plain, files };
}

function parseOptions(goal: string | null): { letter: string; text: string }[] {
  const opts: { letter: string; text: string }[] = [];
  if (!goal) return opts;
  for (const raw of goal.split('\n')) {
    const line = raw.trim();
    const m = /^- ([A-Z])\.\s*(.*)$/.exec(line);
    if (m) opts.push({ letter: m[1], text: m[2] });
  }
  return opts;
}

// 交互记录时间人性化: 裸 UTC ISO(…T…Z)→ 本地时区「MM-DD HH:mm」; 纯日期或无法解析则原样返回
// (存的是 UTC, 对使用者所在时区直接展示 UTC 会差几个小时, 故按本地时间显示)
export function fmtTime(s: string): string {
  if (!s.includes('T')) return s;
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return s;
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

function clarQuestion(c: Task): string {
  const m = /^待确认:\s*/.exec(c.title);
  if (m) return c.title.slice(m[0].length);
  return c.goal ?? c.title;
}

// 提问方限定到"这一条"待确认: 多个待确认并发时, 不能只取全线程最后一条 clarify 事件的 actor
// (那样会让所有并发卡片都显示同一个、往往是错的提问方)。优先找 body 恰好等于该待确认问题的
// 最后一条 clarify 事件; 找不到(理论上不该发生, 兜底)再退回旧行为——取全线程最后一条 clarify。
function findRaiser(thread: TaskEvent[], question: string): string | null {
  for (let i = thread.length - 1; i >= 0; i--) {
    if (thread[i].kind === 'clarify' && thread[i].body === question) return thread[i].actorId;
  }
  for (let i = thread.length - 1; i >= 0; i--) {
    if (thread[i].kind === 'clarify') return thread[i].actorId;
  }
  return null;
}

// 答复框: 回车即提交, 自动聚焦(抽屉打开即可键盘作答), 提交后清空; 空白不提交
function ClarBox({ clarId, autoFocus, onAnswer }: { clarId: string; autoFocus?: boolean; onAnswer: (id: string, answer: string) => void }) {
  const [v, setV] = useState('');
  const submit = () => { const a = v.trim(); if (a) { onAnswer(clarId, a); setV(''); } };
  return (
    <div style={{ marginTop: 8, display: 'flex', gap: 6 }}>
      <input autoFocus={autoFocus} placeholder="答复决策…(或直接点上面的选项)" value={v}
        onChange={(e) => setV(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter') submit(); }} style={{ flex: 1 }} />
      <button className="btn primary" onClick={submit}>答复</button>
    </div>
  );
}

function CommentBox({ taskId, onComment }: { taskId: string; onComment: (taskId: string, body: string) => void }) {
  const [v, setV] = useState('');
  const submit = () => { const b = v.trim(); if (b) { onComment(taskId, b); setV(''); } };
  return (
    <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
      <input placeholder="写条评论…" value={v} onChange={(e) => setV(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter') submit(); }} style={{ flex: 1 }} />
      <button className="btn" onClick={submit}>评论</button>
    </div>
  );
}

export function TaskDetail({ pkg, actorsById, onAnswer, onAct, onComment, onOpenTask, onClose }: {
  pkg: TaskPackage; actorsById: Record<string, Actor>;
  onAnswer: (clarId: string, answer: string) => void;
  onAct: (input: { taskId: string; toActor: string; toRole: Role; toState: TaskState; note: string }, action: TaskAction) => Promise<void> | void;
  onComment: (taskId: string, body: string) => void;
  onOpenTask: (id: string) => void; // 任务引用(面包屑/子任务/关系边/依赖)跳到那个任务的详情
  onClose: () => void;
}) {
  const t = pkg.task;
  const inputPlan = parsePlan(pkg.inputs.inputsMd);
  const outputArtifacts = parseArtifacts(pkg.outputs.outputsMd);
  const openClar = pkg.clarifications.filter((c) => c.state !== 'done');
  const openClarCount = openClar.length;
  const firstOpenId = openClar[0]?.id ?? null; // 只给第一条待决策自动聚焦

  // 槽位有话说才出现(与子任务/关系边/待确认同一规则): 只有标题和"上一棒交付"这类承诺性副标题、
  // 底下却空空如也, 是在承诺不存在的内容 —— 与假复选框同一类不诚实。
  const hasInputs = !!pkg.inputs.goal || inputPlan.plain.length > 0 || inputPlan.items.length > 0 || pkg.inputs.depOutputs.length > 0;
  const hasOutputs = outputArtifacts.plain.length > 0 || outputArtifacts.files.length > 0 || !!pkg.outputs.summary;

  // 抽屉内沿子任务/面包屑/关系边跳转时, 被点的按钮随即卸载 → 焦点会掉回 <body>, 键盘用户丢失位置。
  // 跳转后把焦点送到新任务标题(读屏也借此播报"落到哪了"); 有待决策时让答复框的 autoFocus 接管, 不抢。
  const headingRef = useRef<HTMLHeadingElement>(null);
  const prevTaskId = useRef<string | null>(null);
  useEffect(() => {
    if (prevTaskId.current && prevTaskId.current !== t.id && !firstOpenId) headingRef.current?.focus();
    prevTaskId.current = t.id;
  }, [t.id, firstOpenId]);

  // 「下一步」面板 —— 同一个机制(状态机允许的去向翻成大白话动作), 只是摆放位置随"轮不轮到你"变:
  // 待确认(计划等你拍板)时提到最顶当主角; 其余状态放在底部当收尾动作。
  const nextActions = (
    <NextActions taskId={t.id} state={t.state} currentActor={t.currentActor} actorsById={actorsById} onAct={onAct} />
  );
  const confirmSlot = t.state === 'awaiting_confirm' && (
    <div className="slot">
      <SlotHead icon={<IconWarnTriangle />} tint="warn" title="等你拍板" tag="计划已就绪, 开工前过你这关" />
      <div className="slot-body">
        <p className="confirm-hint">{hasInputs ? '下面「任务内容」是它打算怎么做。你说行就开工。' : '上一步没留下计划详情。你说行就开工。'}</p>
        {nextActions}
      </div>
    </div>
  );

  // 待决策槽位: 决策者最高价值动作, 提到最顶(status 行正下方); 全部已决策则作为历史保留在原语义位置
  const clarSlot = pkg.clarifications.length > 0 && (
    <div className="slot">
      <SlotHead icon={<IconQuestion />} tint="warn" title="等你决定" tag={openClarCount > 0 ? '阻塞中 · 已挂起本任务' : '已全部决策'} />
      <div className="slot-body">
        {pkg.clarifications.map((c) => {
          if (c.state === 'done') {
            return (
              <div key={c.id} className="clar-done">
                <IconCheck />
                <span>{clarQuestion(c)}</span>
                <span className="clar-done-tag">已决策</span>
              </div>
            );
          }
          const opts = parseOptions(c.goal);
          const raiserId = findRaiser(pkg.thread, clarQuestion(c));
          const raiser = raiserId ? actorsById[raiserId] ?? null : null;
          const decider = c.currentActor ? actorsById[c.currentActor] ?? null : null;
          return (
            <div key={c.id} className="clar">
              <div className="clar-head">
                <IconWarnTriangle />
                遇到问题触发待确认
                <span className="st">{c.id} · 待你决策</span>
              </div>
              <div className="clar-body">
                <p className="clar-q">{clarQuestion(c)}</p>
                <div className="clar-route">
                  <ActorBadge actor={raiser} /> 提问
                  <IconArrowRight />
                  <ActorBadge actor={decider} /> 决策
                </div>
                {opts.length > 0 && (
                  <div className="opts">
                    {opts.map((o, i) => (
                      <button key={i} type="button" className="opt" onClick={() => onAnswer(c.id, `${o.letter}. ${o.text}`)}>
                        {o.letter}. {o.text}<span className="k">选这个</span>
                      </button>
                    ))}
                  </div>
                )}
                <ClarBox clarId={c.id} autoFocus={c.id === firstOpenId} onAnswer={onAnswer} />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );

  return (
    <div className="drawer">
      <button className="btn" onClick={onClose} style={{ float: 'right' }}>关闭</button>
      {/* 面包屑是真链接: 点祖先即跳到它的详情 —— 也是抽屉内层层钻进后的返回路径 */}
      <nav className="crumb" aria-label="所属层级">
        {pkg.breadcrumb.map((b) => (
          <span key={b.id} className="crumb-seg">
            <button type="button" className="crumb-link" onClick={() => onOpenTask(b.id)}>{b.title}</button>
            <span className="crumb-sep">▸</span>
          </span>
        ))}
      </nav>
      {/* key=任务id: 换任务时整块重挂 → 触发交叉淡入, 不是硬切(同容器内替换内容的连续性) */}
      <div className="drawer-body" key={t.id}>
      <h2 ref={headingRef} tabIndex={-1}>{t.title}</h2>
      <div className="status-row">
        <span className={`pill ${STATE_PILL[t.state]}`}><span className="d" />{STATE_NAME[t.state]}</span>
        <ActorBadge actor={t.currentActor ? actorsById[t.currentActor] ?? null : null} />
        <RoleChip role={t.currentRole} />
      </div>

      {confirmSlot}
      {openClarCount > 0 && clarSlot}

      {hasInputs && (
      <div className="slot">
        <SlotHead icon={<IconFile />} tint="human" title="任务内容" tag="要做的事和计划" />
        <div className="slot-body">
          {pkg.inputs.goal && <div className="goal"><b>目标:</b> {pkg.inputs.goal}</div>}
          {inputPlan.plain.map((l, i) => <p key={i}>{l}</p>)}
          {inputPlan.items.length > 0 && (
            // 上一棒交付的计划记录, 只读: 用 ✓/素圆点 表示完成与否, 不用复选框
            // ——勾选框会承诺一个不存在的操作(完成与否由状态机决定, 不是这里能勾的)
            <ul className="plan">
              {inputPlan.items.map((it, i) => (
                <li key={i} className={it.done ? 'done' : ''}>
                  {/* ✓ 是 aria-hidden、圆点是 CSS ::before、删除线读屏不播报 → 必须补一句隐藏文本, 否则"已完成/未完成"对读屏毫无区别 */}
                  <span className="pmark">{it.done ? <IconCheck /> : null}<span className="sr-only">{it.done ? '已完成' : '未完成'}</span></span>
                  <span className="ptext">{it.text}</span>
                </li>
              ))}
            </ul>
          )}
          {pkg.inputs.depOutputs.map((d) => (
            <div key={d.taskId} className="dep-row">
              依赖 <button type="button" className="task-link" aria-label={`打开依赖的任务 ${d.taskId}`} onClick={() => onOpenTask(d.taskId)}>{d.taskId}</button>
              <span className="dep-sum">: {d.summary ?? '—'}</span>
            </div>
          ))}
        </div>
      </div>
      )}

      {hasOutputs && (
      <div className="slot">
        <SlotHead icon={<IconOutputs />} tint="agent" title="做出了什么" tag="交出去后就是下一个人的输入" />
        <div className="slot-body">
          {outputArtifacts.plain.map((l, i) => <p key={i}>{l}</p>)}
          {outputArtifacts.files.map((f, i) => (
            <div key={i} className="artifact-row"><span className="ficon"><IconFile /></span>{f}</div>
          ))}
          {pkg.outputs.summary && <div className="summary"><b>摘要:</b> {pkg.outputs.summary}</div>}
        </div>
      </div>
      )}

      {openClarCount === 0 && clarSlot}

      {pkg.subtasks.length > 0 && (
        <div className="slot">
          <SlotHead icon={<IconChecklist />} tint="neutral" title="子任务"
            tag={`${pkg.subtasks.filter((s) => s.state === 'done').length} / ${pkg.subtasks.length}`} />
          <div className="slot-body">
            {/* 子任务是真任务: 整行可点进它的详情; 完成与否用状态点+状态名(与任务树同语言), 不用假复选框 */}
            {pkg.subtasks.map((s) => (
              <button key={s.id} type="button" className={`sub ${s.state === 'done' ? 'done' : ''}`}
                onClick={() => onOpenTask(s.id)}>
                <span className="sdot" style={{ background: STATE_COLOR[s.state] }} />
                <span className="t">{s.title}</span>
                <span className="sstate">{STATE_NAME[s.state]}</span>
                <span className="id">{s.id}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {(pkg.edges.out.length > 0 || pkg.edges.in.length > 0) && (
        <div className="slot">
          <SlotHead icon={<IconLink />} tint="neutral" title="相关任务" />
          <div className="slot-body">
            <div className="edges-list">
              {/* 边指向的都是真任务: id 做成链接可跳过去, 不再是死文字 */}
              {pkg.edges.out.map((e) => (
                <div key={e.id} className="erow"><EdgeChip type={e.type} /><span className="to">→</span>
                  <button type="button" className="task-link" aria-label={`打开本任务指向的 ${e.toTask}`} onClick={() => onOpenTask(e.toTask)}>{e.toTask}</button></div>
              ))}
              {pkg.edges.in.map((e) => (
                <div key={e.id} className="erow"><EdgeChip type={e.type} />
                  <button type="button" className="task-link" aria-label={`打开指向本任务的 ${e.fromTask}`} onClick={() => onOpenTask(e.fromTask)}>{e.fromTask}</button>
                  <span className="to">→ 本任务</span></div>
              ))}
            </div>
          </div>
        </div>
      )}

      {pkg.thread.length > 0 && (
      <div className="slot">
        <SlotHead icon={<IconThread />} tint="neutral" title="经过" tag="谁在什么时候做了什么" />
        <div className="slot-body">
          <div className="thread">
            {pkg.thread.map((ev) => {
              const actorType = actorsById[ev.actorId]?.type;
              const whoCls = actorType === 'human' ? 'h' : 'a';
              const dotCls = ev.kind === 'clarify' || ev.kind === 'decide' ? 'w' : whoCls;
              const who = actorsById[ev.actorId]?.name ?? ev.actorId;
              const verb = KIND_VERB[ev.kind] ?? ev.kind;
              return (
                <div key={ev.id} className={`tevent ${dotCls}`}>
                  <span className="dot" />
                  <div className="tline">
                    <span className={`who ${whoCls}`}>{who}</span> {verb}{ev.body ? `: ${ev.body}` : ''}
                  </div>
                  <div className="twhen">{fmtTime(ev.createdAt)}</div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
      )}

      {/* 待确认时「下一步」已在顶部当主角, 此处不重复 */}
      {t.state !== 'awaiting_confirm' && NEXT_ACTIONS[t.state].length > 0 && (
        <div className="slot">
          <SlotHead icon={<IconHandoff />} tint="human" title="下一步" tag="推进它, 或交给别人" />
          <div className="slot-body">{nextActions}</div>
        </div>
      )}

      <div className="slot">
        <SlotHead icon={<IconPencil />} tint="neutral" title="说点什么" tag="留言给接手的人" />
        <div className="slot-body">
          <CommentBox taskId={t.id} onComment={onComment} />
        </div>
      </div>
      </div>
    </div>
  );
}
