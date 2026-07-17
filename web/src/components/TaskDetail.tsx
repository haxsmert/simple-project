import { useState } from 'react';
import type { TaskPackage, Actor, TaskState, Role, Task, TaskEvent } from '../types';
import { ActorBadge } from './ActorBadge';
import { RoleChip } from './RoleChip';
import { EdgeChip } from './EdgeChip';

const STATE_NAME: Record<TaskState, string> = { planning: '待规划', awaiting_confirm: '待确认', executing: '执行中', awaiting_decision: '待决策', testing: '测试中', done: '完成' };
const STATE_PILL: Record<TaskState, string> = { planning: 'plan', awaiting_confirm: 'confirm', executing: 'exec', awaiting_decision: 'decide', testing: 'test', done: 'done' };
const ROLE_NAME: Record<Role, string> = { planner: '规划', executor: '执行', tester: '测试', questioner: '提问', decider: '决策' };
const ALL_STATES: TaskState[] = ['planning', 'awaiting_confirm', 'executing', 'awaiting_decision', 'testing', 'done'];
const ALL_ROLES: Role[] = ['planner', 'executor', 'tester', 'questioner', 'decider'];
const KIND_VERB: Record<string, string> = {
  handoff: '换手', comment: '评论', output: '提交产出', clarify: '提出待确认', decide: '决策', claim: '领取',
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

function SlotHead({ icon, tint, title, en, tag }: { icon: React.ReactNode; tint: 'human' | 'agent' | 'warn' | 'neutral'; title: string; en: string; tag?: string }) {
  return (
    <div className="slot-head">
      <span className={`ico ${tint}`}>{icon}</span>
      <h4>{title}</h4><span className="en">{en}</span>
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

function HandoffBox({ taskId, currentState, actors, onHandoff }: {
  taskId: string; currentState: TaskState; actors: Actor[];
  onHandoff: (input: { taskId: string; toActor: string; toRole: Role; toState: TaskState; note: string }) => void;
}) {
  const [toActor, setToActor] = useState(actors[0]?.id ?? '');
  const [toRole, setToRole] = useState<Role>('executor');
  const [toState, setToState] = useState<TaskState>(currentState);
  const [note, setNote] = useState('');
  return (
    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
      <select aria-label="换手给" value={toActor} onChange={(e) => setToActor(e.target.value)}>
        {actors.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
      </select>
      <select aria-label="角色" value={toRole} onChange={(e) => setToRole(e.target.value as Role)}>
        {ALL_ROLES.map((r) => <option key={r} value={r}>{ROLE_NAME[r]}</option>)}
      </select>
      <select aria-label="目标状态" value={toState} onChange={(e) => setToState(e.target.value as TaskState)}>
        {ALL_STATES.map((s) => <option key={s} value={s}>{STATE_NAME[s]}</option>)}
      </select>
      <input placeholder="备注(可选)" value={note} onChange={(e) => setNote(e.target.value)} style={{ flex: 1, minWidth: 80 }} />
      <button className="btn primary" onClick={() => { onHandoff({ taskId, toActor, toRole, toState, note }); setNote(''); }}>换手</button>
    </div>
  );
}

// 计划确认块: 决策者在开工前的关卡 —— 一键批准(→执行中)或打回(→待规划), 补充意见随动作记入交互记录。
// 默认把任务交给第一个 agent 执行/重规划; 想指定具体行动者仍可用下方「换手」。
function ConfirmBox({ taskId, actorsById, onHandoff }: {
  taskId: string; actorsById: Record<string, Actor>;
  onHandoff: (input: { taskId: string; toActor: string; toRole: Role; toState: TaskState; note: string }) => void;
}) {
  const [note, setNote] = useState('');
  const agents = Object.values(actorsById).filter((a) => a.type === 'agent');
  const target = agents[0]?.id ?? Object.keys(actorsById)[0] ?? '';
  const approve = () => onHandoff({ taskId, toActor: target, toRole: 'executor', toState: 'executing', note: note.trim() });
  const bounce = () => onHandoff({ taskId, toActor: target, toRole: 'planner', toState: 'planning', note: note.trim() });
  return (
    <div className="confirm-box">
      <p className="confirm-hint">计划已就绪, 等你确认后开工。计划详情见下方「输入」。</p>
      <input className="confirm-note" placeholder="补充意见(可选, 随批准/打回记入交互记录)…"
        value={note} onChange={(e) => setNote(e.target.value)} />
      <div className="confirm-actions">
        <button className="btn primary" onClick={approve} disabled={!target}>✓ 批准开工</button>
        <button className="btn" onClick={bounce} disabled={!target}>↩ 打回重规划</button>
      </div>
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

export function TaskDetail({ pkg, actorsById, onAnswer, onHandoff, onComment, onClose }: {
  pkg: TaskPackage; actorsById: Record<string, Actor>;
  onAnswer: (clarId: string, answer: string) => void;
  onHandoff: (input: { taskId: string; toActor: string; toRole: Role; toState: TaskState; note: string }) => void;
  onComment: (taskId: string, body: string) => void;
  onClose: () => void;
}) {
  const t = pkg.task;
  const inputPlan = parsePlan(pkg.inputs.inputsMd);
  const outputArtifacts = parseArtifacts(pkg.outputs.outputsMd);
  const openClar = pkg.clarifications.filter((c) => c.state !== 'done');
  const openClarCount = openClar.length;
  const firstOpenId = openClar[0]?.id ?? null; // 只给第一条待决策自动聚焦

  // 待确认槽位: 计划就绪、开工前的人类关卡 —— 与待决策同为"轮到你"的最高价值动作, 提到最顶。
  const confirmSlot = t.state === 'awaiting_confirm' && (
    <div className="slot">
      <SlotHead icon={<IconWarnTriangle />} tint="warn" title="待你确认" en="Confirm" tag="计划就绪 · 开工前的关卡" />
      <div className="slot-body">
        <ConfirmBox taskId={t.id} actorsById={actorsById} onHandoff={onHandoff} />
      </div>
    </div>
  );

  // 待决策槽位: 决策者最高价值动作, 提到最顶(status 行正下方); 全部已决策则作为历史保留在原语义位置
  const clarSlot = pkg.clarifications.length > 0 && (
    <div className="slot">
      <SlotHead icon={<IconQuestion />} tint="warn" title="待确认" en="Clarification" tag={openClarCount > 0 ? '阻塞中 · 已挂起本任务' : '已全部决策'} />
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
      <div className="crumb">{pkg.breadcrumb.map((b) => <span key={b.id}>{b.title} ▸</span>)}</div>
      <h2>{t.title}</h2>
      <div className="status-row">
        <span className={`pill ${STATE_PILL[t.state]}`}><span className="d" />{STATE_NAME[t.state]}</span>
        <ActorBadge actor={t.currentActor ? actorsById[t.currentActor] ?? null : null} />
        <RoleChip role={t.currentRole} />
      </div>

      {confirmSlot}
      {openClarCount > 0 && clarSlot}

      <div className="slot">
        <SlotHead icon={<IconFile />} tint="human" title="输入" en="Inputs" tag="上一棒交付" />
        <div className="slot-body">
          {pkg.inputs.goal && <div className="goal"><b>目标:</b> {pkg.inputs.goal}</div>}
          {inputPlan.plain.map((l, i) => <p key={i}>{l}</p>)}
          {inputPlan.items.length > 0 && (
            <ul className="plan">
              {inputPlan.items.map((it, i) => (
                <li key={i} className={it.done ? 'done' : ''}>
                  <span className="ck">{it.done && <IconCheck />}</span>
                  <span>{it.text}</span>
                </li>
              ))}
            </ul>
          )}
          {pkg.inputs.depOutputs.map((d) => (
            <div key={d.taskId} className="card-id">依赖 {d.taskId}: {d.summary ?? '—'}</div>
          ))}
        </div>
      </div>

      <div className="slot">
        <SlotHead icon={<IconOutputs />} tint="agent" title="产出" en="Outputs" tag="换手后自动成为下一棒的输入" />
        <div className="slot-body">
          {outputArtifacts.plain.map((l, i) => <p key={i}>{l}</p>)}
          {outputArtifacts.files.map((f, i) => (
            <div key={i} className="artifact-row"><span className="ficon"><IconFile /></span>{f}</div>
          ))}
          {pkg.outputs.summary && <div className="summary"><b>摘要:</b> {pkg.outputs.summary}</div>}
        </div>
      </div>

      {openClarCount === 0 && clarSlot}

      {pkg.subtasks.length > 0 && (
        <div className="slot">
          <SlotHead icon={<IconChecklist />} tint="neutral" title="子任务" en="Subtasks"
            tag={`${pkg.subtasks.filter((s) => s.state === 'done').length} / ${pkg.subtasks.length}`} />
          <div className="slot-body">
            {pkg.subtasks.map((s) => (
              <div key={s.id} className={`sub ${s.state === 'done' ? 'done' : ''}`}>
                <span className="cb">{s.state === 'done' && <IconCheck />}</span>
                <span className="t">{s.title}</span>
                <span className="id">{s.id}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {(pkg.edges.out.length > 0 || pkg.edges.in.length > 0) && (
        <div className="slot">
          <SlotHead icon={<IconLink />} tint="neutral" title="关系边" en="Edges" />
          <div className="slot-body">
            <div className="edges-list">
              {pkg.edges.out.map((e) => (
                <div key={e.id} className="erow"><EdgeChip type={e.type} /><span className="to">→ {e.toTask}</span></div>
              ))}
              {pkg.edges.in.map((e) => (
                <div key={e.id} className="erow"><EdgeChip type={e.type} /><span className="to">{e.fromTask} →</span></div>
              ))}
            </div>
          </div>
        </div>
      )}

      <div className="slot">
        <SlotHead icon={<IconThread />} tint="neutral" title="交互记录" en="Thread" tag="换手 / 评论 / 提问 / 决策全在此" />
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

      <div className="slot">
        <SlotHead icon={<IconHandoff />} tint="human" title="换手" en="Handoff" tag="转交给下一棒" />
        <div className="slot-body">
          <HandoffBox taskId={t.id} currentState={t.state} actors={Object.values(actorsById)} onHandoff={onHandoff} />
        </div>
      </div>

      <div className="slot">
        <SlotHead icon={<IconPencil />} tint="neutral" title="评论" en="Comment" tag="补充说明" />
        <div className="slot-body">
          <CommentBox taskId={t.id} onComment={onComment} />
        </div>
      </div>
    </div>
  );
}
