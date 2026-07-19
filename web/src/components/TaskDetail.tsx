import { useState, useEffect, useRef } from 'react';
import type { TaskPackage, Actor, Task, TaskEvent } from '../types';
import { ActorBadge } from './ActorBadge';
import { RoleChip } from './RoleChip';
import { EdgeChip } from './EdgeChip';
import { STATE_NAME, STATE_COLOR, HOLD_NAME, HOLD_FLAG, PROJECT_STATE_NAME } from '../states';
import { NextActions } from './NextActions';
import { actionsFor, projectActionsFor, type TaskAction, type ActInput } from '../actions';
// 「经过」的叙述层在 events.ts(单一来源, 项目卡的"最近动静"同引): 谁+做了什么+给谁+怎么变
import { eventText, timeAgo } from '../events';

const STATE_PILL = { planning: 'plan', executing: 'exec', testing: 'test', done: 'done' } as const;
const HOLD_PILL = { confirm: 'confirm', decision: 'decide' } as const;

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

// ——— 数据解析(planMd / outputsMd / goal 里的 markdown 片段) ———
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

// 任务引用三件套: 标题(人话)+ 编码(小字)+ 跳转。编码保留但不许独自出场 ——
// "依赖 R-20"这种裸编码, 不点进去没人知道是什么, 等于强迫人跳转一次才能读懂本页。
// 可及名用"关系 + 标题"(读屏用户更不需要编码)。
function TaskRef({ title, id, label, onOpen }: { title: string; id: string; label: string; onOpen: (id: string) => void }) {
  return (
    <button type="button" className="task-link" aria-label={label} onClick={() => onOpen(id)}>
      {title}<span className="tl-id" aria-hidden="true">{id}</span>
    </button>
  );
}

// 计划正文(自由行 + 只读清单): 拍板槽和「任务内容」共用同一渲染 —— 拍板的依据必须和批准按钮同址,
// 不能让人"往下翻到别的槽位去找计划"(识别优于回忆)
function PlanBlock({ plan }: { plan: ReturnType<typeof parsePlan> }) {
  return (
    <>
      {plan.plain.map((l, i) => <p key={i}>{l}</p>)}
      {plan.items.length > 0 && (
        // 只读: 用 ✓/素圆点 表示完成与否, 不用复选框
        // ——勾选框会承诺一个不存在的操作(完成与否由状态机决定, 不是这里能勾的)
        <ul className="plan">
          {plan.items.map((it, i) => (
            <li key={i} className={it.done ? 'done' : ''}>
              {/* ✓ 是 aria-hidden、圆点是 CSS ::before、删除线读屏不播报 → 必须补一句隐藏文本, 否则"已完成/未完成"对读屏毫无区别 */}
              <span className="pmark">{it.done ? <IconCheck /> : null}<span className="sr-only">{it.done ? '已完成' : '未完成'}</span></span>
              <span className="ptext">{it.text}</span>
            </li>
          ))}
        </ul>
      )}
    </>
  );
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

export function TaskDetail({ pkg, actorsById, onAnswer, onAct, onComment, onOpenTask, onUpdate, onDelete, routing, onClose }: {
  pkg: TaskPackage; actorsById: Record<string, Actor>;
  onAnswer: (clarId: string, answer: string) => void;
  onAct: (input: ActInput, action: TaskAction) => Promise<boolean>;
  onComment: (taskId: string, body: string) => void;
  onOpenTask: (id: string) => void; // 任务引用(面包屑/子任务/关系边/依赖)跳到那个任务的详情
  onUpdate: (taskId: string, patch: { title?: string; goal?: string }) => Promise<boolean>; // 改标题/目标(agent 侧早有, 页面补齐)
  onDelete: (taskId: string) => Promise<boolean>; // 删除任务(不可恢复, 有子任务后端会拒)
  routing: Record<string, { actorId: string | null; basis: 'history' | 'fallback' }>; // 角色→{默认派给谁, 依据}
  onClose: () => void;
}) {
  const t = pkg.task;
  // 项目 = 顶层任务(2026-07-19 定调): 两态(执行中/已完结), 动作是 完结/重开/换负责人, 不走四阶段
  const isProject = t.parentId === null;
  // 编辑态: 标题/目标就地改(改动会记进「经过」); 删除要二次确认(不可恢复)
  const [editing, setEditing] = useState(false);
  const [editTitle, setEditTitle] = useState(t.title);
  const [editGoal, setEditGoal] = useState(t.goal ?? '');
  const [confirmDelete, setConfirmDelete] = useState(false);
  const inputPlan = parsePlan(pkg.inputs.planMd);
  const outputArtifacts = parseArtifacts(pkg.outputs.outputsMd);
  const openClar = pkg.clarifications.filter((c) => c.state !== 'done');
  const openClarCount = openClar.length;
  const firstOpenId = openClar[0]?.id ?? null; // 只给第一条待决策自动聚焦

  // 槽位有话说才出现(与子任务/关系边/待确认同一规则): 只有标题和"上一棒交付"这类承诺性副标题、
  // 底下却空空如也, 是在承诺不存在的内容 —— 与假复选框同一类不诚实。
  const parentNode = pkg.breadcrumb[pkg.breadcrumb.length - 1] ?? null; // 直接父任务(面包屑末位)
  const hasInputs = !!pkg.inputs.goal || inputPlan.plain.length > 0 || inputPlan.items.length > 0 || pkg.inputs.depOutputs.length > 0;
  const hasOutputs = outputArtifacts.plain.length > 0 || outputArtifacts.files.length > 0 || !!pkg.outputs.summary;

  // 抽屉内沿子任务/面包屑/关系边跳转时, 被点的按钮随即卸载 → 焦点会掉回 <body>, 键盘用户丢失位置。
  // 跳转后把焦点送到新任务标题(读屏也借此播报"落到哪了"); 有待决策时让答复框的 autoFocus 接管, 不抢。
  const headingRef = useRef<HTMLHeadingElement>(null);
  const prevTaskId = useRef<string | null>(null);
  useEffect(() => {
    // 初次打开与抽屉内跳转都把焦点送进抽屉(否则焦点留在被遮罩盖住的卡上, Tab 要穿过整排背景卡才进来);
    // 有待决策时让答复框的 autoFocus 接管, 不抢
    if (prevTaskId.current !== t.id && !firstOpenId) headingRef.current?.focus();
    prevTaskId.current = t.id;
  }, [t.id, firstOpenId]);

  // 「下一步」面板 —— 同一个机制(状态机允许的去向翻成大白话动作), 只是摆放位置随"轮不轮到你"变:
  // 待确认(计划等你拍板)时提到最顶当主角; 其余状态放在底部当收尾动作。
  const nextActions = (
    <NextActions key={t.id} taskId={t.id} state={t.state} hold={t.hold} currentActor={t.currentActor}
      currentRole={t.currentRole} isProject={isProject} actorsById={actorsById} routing={routing}
      content={{ planMd: pkg.inputs.planMd, outputsMd: pkg.outputs.outputsMd, summary: pkg.outputs.summary }}
      openSubtasks={pkg.subtasks.filter((s) => s.state !== 'done').length} onAct={onAct} />
  );
  // 拍板槽自带拍板依据: 目标 + 计划正文就在批准/打回按钮上方 —— 依据和动作分居两个槽位,
  // 人就得"往下翻找计划再翻回来点批准", 这正是"计划罗列不直观"的病根。
  // 批准/打回只呈现给**任务真正在其手里的人类**: 关卡在别人手里时亮着按钮, 是把不属于你的动作递给你(2026-07-17 实洞)
  const humanActor = Object.values(actorsById).find((a) => a.type === 'human');
  const confirmMine = !!humanActor && t.currentActor === humanActor.id;
  const holder = t.currentActor ? actorsById[t.currentActor]?.name ?? t.currentActor : '无人';
  const hasPlanText = inputPlan.plain.length > 0 || inputPlan.items.length > 0;
  const confirmSlot = t.hold === 'confirm' && (
    <div className="slot">
      <SlotHead icon={<IconWarnTriangle />} tint="warn" title={confirmMine ? '等你拍板' : '等确认中'}
        tag={confirmMine ? '计划已就绪, 开工前过你这关' : `在 ${holder} 手里`} />
      <div className="slot-body">
        {pkg.inputs.goal && <div className="goal"><b>目标:</b> {pkg.inputs.goal}</div>}
        {hasPlanText
          ? <PlanBlock plan={inputPlan} />
          : <p className="confirm-hint">上一步没留下计划详情 —— 可以打回要一份, 也可以直接拍板。</p>}
        {confirmMine ? nextActions : <p className="confirm-hint">这一关在 {holder} 手里, 等对方批准或打回。</p>}
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
    <div className="drawer" role="dialog" aria-modal="true" aria-label={`任务详情: ${t.title}`}>
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
      {editing ? (
        <div className="edit-panel" role="group" aria-label="编辑任务"
          onKeyDown={(e) => { if (e.key === 'Escape') { e.stopPropagation(); setEditing(false); } }}>
          {/* Esc 只退编辑不关抽屉: 写到一半按 Esc 把抽屉连改动一起关掉 = 数据丢失(审计实锤) */}
          <input value={editTitle} onChange={(e) => setEditTitle(e.target.value)} aria-label="标题" placeholder="任务标题" autoFocus />
          <textarea rows={2} value={editGoal} onChange={(e) => setEditGoal(e.target.value)} aria-label="目标" placeholder="目标(一句话说清做成什么样)" />
          <div className="act-form-btns">
            <button type="button" className="btn primary" disabled={!editTitle.trim()}
              onClick={async () => { if (await onUpdate(t.id, { title: editTitle.trim(), goal: editGoal.trim() || undefined })) setEditing(false); }}>保存</button>
            <button type="button" className="btn" onClick={() => setEditing(false)}>取消</button>
          </div>
        </div>
      ) : (
        <div className="title-row">
          <h2 ref={headingRef} tabIndex={-1}>{t.title}</h2>
          {/* 编辑入口给个真按钮: 建错了要能改(改动记进「经过」), 不能只有 agent 侧改得动 */}
          <button type="button" className="btn ghost-edit" aria-label="编辑标题与目标"
            onClick={() => { setEditTitle(t.title); setEditGoal(t.goal ?? ''); setEditing(true); }}><IconPencil /></button>
        </div>
      )}
      <div className="status-row">
        {/* 项目用项目语言(执行中/已完结), 不套任务四阶段名; 项目的角色是内部标签, 不亮出来 */}
        <span className={`pill ${STATE_PILL[t.state]}`}><span className="d" />{isProject ? PROJECT_STATE_NAME[t.state] : STATE_NAME[t.state]}</span>
        {t.hold && <span className={`pill ${HOLD_PILL[t.hold]}`}><span className="d" />{HOLD_NAME[t.hold]}</span>}
        <ActorBadge actor={t.currentActor ? actorsById[t.currentActor] ?? null : null} />
        {!isProject && <RoleChip role={t.currentRole} />}
      </div>

      {confirmSlot}
      {openClarCount > 0 && clarSlot}

      {/* ── 项目模式(2026-07-19 用户: "项目详情太简单/没有结构化"): 任务的四槽位对项目天然是空的
          (没有产出/问题卡/自身事件), 换成项目自己的结构 —— 方向 → 任务全景 → 最近动静 → 项目动作。 */}
      {isProject && (
        <div className="slot">
          <SlotHead icon={<IconFile />} tint="human" title="方向" tag="为什么开这个方向" />
          <div className="slot-body">
            {t.goal
              ? <p className="pv-goal">{t.goal}</p>
              : <p className="confirm-hint">还没写目标 —— 点右上 ✎ 补上(项目不能只有一个名字)。</p>}
            {t.state === 'done' && (
              <p className="pv-closed-note">已完结{pkg.subtasks.filter((s) => s.state !== 'done').length > 0
                ? ` · 完结时遗留 ${pkg.subtasks.filter((s) => s.state !== 'done').length} 项未完成(见下)` : ''}</p>
            )}
          </div>
        </div>
      )}
      {isProject && (() => {
        // 任务全景: 按阶段分组(在跑的在前), 组内挂起冒头(琥珀+「待你确认/待你决策」);
        // 行内第二列给"比阶段更有用"的信息 —— 阶段已由组头表达, 行里说 挂起/负责人
        const order: Task['state'][] = ['executing', 'testing', 'planning', 'done'];
        const groups = order
          .map((s) => ({ state: s, tasks: pkg.subtasks.filter((x) => x.state === s).sort((a, b) => (b.hold ? 1 : 0) - (a.hold ? 1 : 0)) }))
          .filter((g) => g.tasks.length > 0);
        const attnCount = pkg.subtasks.filter((x) => x.hold).length;
        const dist = groups.map((g) => `${STATE_NAME[g.state]} ${g.tasks.length}`).join(' · ');
        return (
          <div className="slot">
            <SlotHead icon={<IconChecklist />} tint={attnCount > 0 ? 'warn' : 'neutral'} title="任务全景"
              tag={attnCount > 0 ? `🔔 ${attnCount} 待你处理 · ${dist}` : (dist || '还没有任务')} />
            <div className="slot-body">
              {groups.length === 0 && <p className="confirm-hint">还没有任务 —— 回看板「+ 追加任务」开工。</p>}
              {groups.map((g) => (
                <div key={g.state} className="pv-group">
                  <div className="pv-group-head">
                    <span className="sdot" style={{ background: STATE_COLOR[g.state] }} />
                    {STATE_NAME[g.state]}<span className="pv-cnt">{g.tasks.length}</span>
                  </div>
                  {g.tasks.map((s) => (
                    <button key={s.id} type="button" className={`sub ${s.state === 'done' ? 'done' : ''}${s.hold ? ' held' : ''}`}
                      onClick={() => onOpenTask(s.id)}>
                      <span className="t">{s.title}</span>
                      <span className="sstate">{s.hold ? HOLD_FLAG[s.hold] : s.currentActor ? actorsById[s.currentActor]?.name ?? s.currentActor : '未分派'}</span>
                      <span className="id">{s.id}</span>
                    </button>
                  ))}
                </div>
              ))}
            </div>
          </div>
        );
      })()}
      {isProject && (() => {
        const acts = pkg.projectActivity ?? [];
        return (
          <div className="slot">
            <SlotHead icon={<IconThread />} tint="neutral" title="最近动静" tag="全项目 · 谁在哪个任务干了什么" />
            <div className="slot-body">
              {acts.length === 0 ? <p className="confirm-hint">还没动静。</p> : (
                <div className="thread">
                  {acts.map((ev, i) => {
                    const actorType = actorsById[ev.actorId]?.type;
                    const whoCls = actorType === 'human' ? 'h' : 'a';
                    const dotCls = ev.kind === 'clarify' || ev.kind === 'decide' ? 'w' : whoCls;
                    return (
                      <div key={i} className={`tevent ${dotCls}`}>
                        <span className="dot" />
                        <div className="tline">
                          <span className={`who ${whoCls}`}>{ev.actorName}</span>{' '}
                          {eventText(ev, (id) => (id ? actorsById[id]?.name ?? id : null), { project: ev.taskId === t.id })}
                          {ev.taskId !== t.id && <> · <button type="button" className="crumb-link" onClick={() => onOpenTask(ev.taskId)}>{ev.taskTitle}</button></>}
                          {ev.body ? `: ${ev.body}` : ''}
                        </div>
                        <div className="twhen">{timeAgo(ev.createdAt)}</div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        );
      })()}

      {/* 等确认时目标+计划已亮在拍板槽的按钮旁, 这里不再重复(同屏两份同一计划是噪音), 只剩依赖时保留依赖 */}
      {!isProject && (t.hold === 'confirm' ? pkg.inputs.depOutputs.length > 0 : hasInputs) && (
      <div className="slot">
        <SlotHead icon={<IconFile />} tint="human" title="任务内容" tag="要做的事和计划" />
        <div className="slot-body">
          {t.hold !== 'confirm' && (
            <>
              {pkg.inputs.goal && <div className="goal"><b>目标:</b> {pkg.inputs.goal}</div>}
              <PlanBlock plan={inputPlan} />
            </>
          )}
          {pkg.inputs.depOutputs.map((d) => (
            <div key={d.taskId} className="dep-row">
              依赖 <TaskRef title={d.title} id={d.taskId} label={`打开依赖的任务 ${d.title}`} onOpen={onOpenTask} />
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

      {!isProject && pkg.subtasks.length > 0 && (
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
                {/* 挂起中的子任务亮挂起(轮到人的信号), 比只报阶段有用 —— 问题卡显示"待规划"等于没说 */}
                <span className="sstate">{s.hold ? HOLD_NAME[s.hold] : STATE_NAME[s.state]}</span>
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
              {/* 边指向的都是真任务: 标题+编码做成链接可跳过去 —— 编码不许独自出场, 光秃秃的 R-20 没人知道是什么 */}
              {pkg.edges.out.map((e) => (
                <div key={e.id} className="erow"><EdgeChip type={e.type} /><span className="to">→</span>
                  <TaskRef title={e.peerTitle} id={e.toTask} label={`打开本任务指向的 ${e.peerTitle}`} onOpen={onOpenTask} /></div>
              ))}
              {pkg.edges.in.map((e) => (
                <div key={e.id} className="erow"><EdgeChip type={e.type} />
                  <TaskRef title={e.peerTitle} id={e.fromTask} label={`打开指向本任务的 ${e.peerTitle}`} onOpen={onOpenTask} />
                  <span className="to">→ 本任务</span></div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* 项目自身的「经过」并进上面的「最近动静」(全树), 不重复渲染一份贫血版 */}
      {!isProject && pkg.thread.length > 0 && (
      <div className="slot">
        <SlotHead icon={<IconThread />} tint="neutral" title="经过" tag="谁在什么时候做了什么" />
        <div className="slot-body">
          <div className="thread">
            {pkg.thread.map((ev) => {
              const actorType = actorsById[ev.actorId]?.type;
              const whoCls = actorType === 'human' ? 'h' : 'a';
              const dotCls = ev.kind === 'clarify' || ev.kind === 'decide' ? 'w' : whoCls;
              const who = actorsById[ev.actorId]?.name ?? ev.actorId;
              const verb = eventText(ev, (id) => (id ? actorsById[id]?.name ?? id : null), { project: isProject });
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

      {/* 这张卡本身就是"待你拍板的问题"(澄清任务): 它自己没有「等你决定」块(那长在父任务上),
          也没有「下一步」(答复才是出路) —— 不给指路就是死胡同, 只能关掉, 界面还不说。 */}
      {t.hold === 'decision' && pkg.clarifications.length === 0 && parentNode && (
        <div className="slot">
          <SlotHead icon={<IconQuestion />} tint="warn" title="等你决定" tag="这是一个等你拍板的问题" />
          <div className="slot-body">
            <p className="confirm-hint">这个问题要在它所属的任务里答复(那边能看到上下文和选项)。</p>
            <button type="button" className="btn primary" onClick={() => onOpenTask(parentNode.id)}>
              去「{parentNode.title}」答复 →
            </button>
          </div>
        </div>
      )}

      {/* 等确认时「下一步」已在顶部当主角, 此处不重复 */}
      {t.hold !== 'confirm' && (isProject ? projectActionsFor(t.state, t.currentRole) : actionsFor(t.state, t.hold)).length > 0 && (
        <div className="slot">
          {/* 任务在 agent 手里时, 这些动作是"替它推进"(人类是总管有此权限), 但要如实说, 不能和"轮到你"长一样 */}
          <SlotHead icon={<IconHandoff />} tint="human" title={isProject ? '项目动作' : '下一步'}
            tag={isProject ? (t.state === 'done' ? '已完结 —— 可以重开续作' : '完结、重开或换负责人')
              : !confirmMine && t.currentActor && actorsById[t.currentActor]?.type === 'agent' ? `在 ${holder} 手里 —— 你是替它推进` : '推进它, 或交给别人'} />
          <div className="slot-body">{nextActions}</div>
        </div>
      )}

      <div className="slot">
        <SlotHead icon={<IconPencil />} tint="neutral" title="说点什么" tag="留言给接手的人" />
        <div className="slot-body">
          <CommentBox taskId={t.id} onComment={onComment} />
        </div>
      </div>

      {/* 删除收在最底且要二次确认: 不可恢复(连同历史与关系边); 有子任务后端会拒并说明 */}
      <div className="danger-zone">
        {confirmDelete ? (
          <div className="act-form" role="group" aria-label="确认删除"
            onKeyDown={(e) => { if (e.key === 'Escape') { e.stopPropagation(); setConfirmDelete(false); } }}>
            <div className="act-form-title">删除后不可恢复(连同它的历史与关系)。{pkg.subtasks.length > 0 ? '它还有子任务, 需先移走或删除。' : ''}</div>
            <div className="act-form-btns">
              <button type="button" className="btn danger-solid" onClick={async () => { if (await onDelete(t.id)) setConfirmDelete(false); }}>确认删除</button>
              <button type="button" autoFocus className="btn" onClick={() => setConfirmDelete(false)}>取消</button>
            </div>
          </div>
        ) : (
          <button type="button" className="btn danger-ghost" onClick={() => setConfirmDelete(true)}>删除这个任务…</button>
        )}
      </div>
      </div>
    </div>
  );
}
