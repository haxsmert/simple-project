import { useEffect, useState, useCallback, useRef } from 'react';
import { api } from './api';
import type { BoardColumn, TaskNode, TaskPackage, Actor } from './types';
import { Board } from './components/Board';
import { Tree } from './components/Tree';
import { TaskDetail } from './components/TaskDetail';
import { ProjectPicker } from './components/ProjectPicker';
import type { TaskAction, ActInput } from './actions';

type NavNode = { id: string; title: string };
// "全部任务"作为伪节点占据路径第一格: 与真实项目同构, 面包屑/上溯/加载全走同一套机制, 不开特例分支
const ALL_NODE: NavNode = { id: 'all', title: '全部任务' };

// 导航 = 一条路径栈(2026-07-17 去杂乱约定): [] 项目总览 → [项目] → [项目,任务] → … 任意深度即递归树。
// 原「项目/任务」两个 tab 与面包屑概念重复(同一处两个名字两套入口), 已删; 「看板/任务树」只是同一路径的两种透镜。
export function App() {
  const [view, setView] = useState<'board' | 'tree'>('board');
  const [path, setPath] = useState<NavNode[]>([]);
  const [projectCols, setProjectCols] = useState<BoardColumn[]>([]);
  const [taskCols, setTaskCols] = useState<BoardColumn[]>([]);
  const [tree, setTree] = useState<TaskNode[]>([]);
  const [actors, setActors] = useState<Actor[]>([]);
  // 角色→{默认派给谁, 依据}。basis='fallback' 表示没人扮演过该角色, 这是猜的 —— 界面要如实说
  const [routing, setRouting] = useState<Record<string, { actorId: string | null; basis: 'history' | 'fallback' }>>({});
  const [detail, setDetail] = useState<TaskPackage | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false); // 首屏数据是否已到 —— 未到前不渲染空态, 避免误报"还没有项目"
  const [draft, setDraft] = useState<{ kind: 'project' | 'task'; title: string } | null>(null);
  const triggerRef = useRef<HTMLElement | null>(null); // 打开抽屉的那张卡, 关闭后把焦点还给它(键盘闭环)
  // 动作反馈: toast 说"我干成了什么", flashId 让看板上那张卡亮一下 —— 两者合起来把"我点了→它去哪了"的因果做可见
  // 带 nonce: 同文案/同 id 连发时 React 会 bail-out 导致计时器不重置、动画不重播
  const [toast, setToast] = useState<{ text: string; n: number } | null>(null);
  const [flash, setFlash] = useState<{ id: string; n: number } | null>(null);
  const nonce = useRef(0);

  const closeDetail = useCallback(() => { setDetail(null); triggerRef.current?.focus?.(); }, []);

  const actorsById = Object.fromEntries(actors.map((a) => [a.id, a]));
  const projects = projectCols.flatMap((c) => c.tasks).map((t) => ({ id: t.id, title: t.title }));
  const pendingTotal = projectCols.flatMap((c) => c.tasks).reduce((s, t) => s + (t.attention ?? 0), 0);
  const atRoot = path.length === 0;
  const currentId = atRoot ? null : path[path.length - 1].id;
  const isAll = currentId === 'all';
  const canCreateTask = !!currentId && !isAll; // "全部任务"无父节点, 不能就地追加
  const canAscend = view === 'board' && !atRoot;

  const guard = useCallback(async (fn: () => Promise<void>) => {
    try { setError(null); await fn(); } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
  }, []);

  const refresh = useCallback(async () => {
    const [p, t, a, r] = await Promise.all([api.projects(), api.tree(), api.actors(), api.routing()]);
    setProjectCols(p); setTree(t); setActors(a); setRouting(r);
  }, []);
  // 首屏无论成败都置 loaded: 成功→出看板, 失败→出错误横幅+可导航的空看板, 绝不因失败卡死在"加载中…"
  useEffect(() => { guard(refresh).finally(() => setLoaded(true)); }, [refresh, guard]);

  // 导航/视图一变就废弃未提交的新建草稿 —— 否则在项目 A 开的表单跳到项目 B 后提交, 会把任务建到 B 下
  useEffect(() => { setDraft(null); }, [path, view]);

  useEffect(() => { // toast 3.5s 自动收(不抢焦点, aria-live 播报)
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 3500);
    return () => clearTimeout(t);
  }, [toast]);
  useEffect(() => { // 卡片高亮放完就清, 免得重复触发
    if (!flash) return;
    const t = setTimeout(() => setFlash(null), 1200);
    return () => clearTimeout(t);
  }, [flash]);

  useEffect(() => {
    if (!detail) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') closeDetail(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [detail, closeDetail]);

  // 加载某节点的子任务看板; 'all' = 跨项目的一层任务
  const loadBoard = useCallback(async (nodeId: string) => {
    setTaskCols(nodeId === 'all' ? await api.allTasks() : await api.taskBoard(nodeId));
  }, []);

  // 项目总览点项目 → 钻进它的任务(路径栈 = [项目])
  const enterProject = useCallback((p: NavNode) => guard(async () => {
    setPath([p]); await loadBoard(p.id);
  }), [guard, loadBoard]);

  // 钻入一个任务的子任务(路径栈 +1 层) —— 递归下钻的落点
  const descend = useCallback((node: NavNode) => guard(async () => {
    setPath((p) => [...p, node]); await loadBoard(node.id);
  }), [guard, loadBoard]);

  // 上一层: 逐层弹回, 弹到底回到项目总览
  const ascend = useCallback(() => guard(async () => {
    if (view !== 'board' || path.length === 0) return;
    if (path.length >= 2) { const np = path.slice(0, -1); setPath(np); await loadBoard(np[np.length - 1].id); }
    else setPath([]);
  }), [guard, loadBoard, view, path]);

  // 面包屑跳转: index=-1 回项目总览; 否则截断到 path[0..index]
  const jumpTo = useCallback((index: number) => guard(async () => {
    if (index < 0) { setPath([]); return; }
    const np = path.slice(0, index + 1); setPath(np); await loadBoard(np[np.length - 1].id);
  }), [guard, loadBoard, path]);

  // 项目选择器(面包屑第一格): 横跳到某项目或全部任务
  const changeFilter = useCallback((f: string) => guard(async () => {
    if (f === 'all') { setPath([ALL_NODE]); await loadBoard('all'); }
    else { const p = projects.find((x) => x.id === f); if (p) { setPath([p]); await loadBoard(f); } }
  }), [guard, loadBoard, projects]);

  // 抽屉未开时才记触发卡片: 在抽屉内沿子任务/关系边层层跳转时保留最初的卡, 关掉直接回到出发点
  const openTask = useCallback((id: string) => {
    if (!detail) triggerRef.current = document.activeElement as HTMLElement;
    return guard(async () => { setDetail(await api.task(id)); });
  }, [guard, detail]);

  // 不按 view 门控: 树视图里的操作(答复/换手)也要刷新 taskCols, 否则切回看板是过期数据
  const reloadCurrent = useCallback(async () => {
    await refresh();
    if (currentId) await loadBoard(currentId);
  }, [refresh, loadBoard, currentId]);

  const submitDraft = useCallback(() => guard(async () => {
    if (!draft || !draft.title.trim()) { setDraft(null); return; }
    if (draft.kind === 'project') { await api.createTask({ title: draft.title.trim() }); }
    else if (currentId && currentId !== 'all') { await api.createTask({ title: draft.title.trim(), parentId: currentId }); await loadBoard(currentId); }
    await refresh();
    setDraft(null);
  }), [draft, currentId, loadBoard, refresh, guard]);

  const onAnswer = useCallback((clarId: string, answer: string) => guard(async () => {
    const you = actors.find((a) => a.type === 'human')?.id ?? 'admin';
    await api.answer(clarId, { byActor: you, answer });
    await reloadCurrent();
    if (detail) setDetail(await api.task(detail.task.id));
  }), [actors, detail, reloadCurrent, guard]);
  // 执行一个「下一步」动作: 做完给出成功反馈(toast) + 让被影响的卡在看板上亮一下
  // 执行一个「下一步」动作。返回是否成功 —— 失败时 NextActions 不该抹掉人家写的说明。
  // 成功后关抽屉: 你在这条任务上的事已了, 回到看板才看得见那张卡挪去了哪(高亮就在那儿),
  // 否则遮罩+抽屉正好盖住看板, 高亮亮给空气看。
  const onAct = useCallback(async (input: ActInput, action: TaskAction) => {
    let ok = false;
    await guard(async () => {
      const you = actors.find((a) => a.type === 'human')?.id ?? 'admin';
      // 动作携带的内容先落库再转交: 转交失败(状态被并发改了等)时计划/产出也已保存, 不丢人家写的字
      if (input.planMd !== undefined) await api.plan(input.taskId, { byActor: you, planMd: input.planMd });
      if (input.outputs) await api.output(input.taskId, { byActor: you, outputsMd: input.outputs.outputsMd, summary: input.outputs.summary });
      // 全量转发去向字段 —— 显式列举曾在 ActInput 扩展 toHold 时静默丢字段(打回被误当"保持挂起的原地改派"拦下, 实锤)
      await api.handoff({ taskId: input.taskId, toActor: input.toActor, toRole: input.toRole, toState: input.toState, toHold: input.toHold, note: input.note, byActor: you });
      await reloadCurrent();
      const who = actorsById[input.toActor]?.name;
      const suffix = action.keepActor || !who ? '' : ` · 交给 ${who}`;
      const n = ++nonce.current;
      setToast({ text: `${action.done}${suffix}`, n });
      setFlash({ id: input.taskId, n });
      setDetail(null); // 关抽屉, 让回执/高亮落在看板上
      ok = true;
    });
    return ok;
  }, [actors, actorsById, reloadCurrent, guard]);
  // 页面侧的改/删(能力对齐 agent 侧): 改动记「经过」; 删除成功关抽屉回看板
  const onUpdateTask = useCallback(async (taskId: string, patch: { title?: string; goal?: string }) => {
    let ok = false;
    await guard(async () => {
      const you = actors.find((a) => a.type === 'human')?.id ?? 'admin';
      await api.updateTask(taskId, { byActor: you, ...patch });
      await reloadCurrent();
      if (detail) setDetail(await api.task(taskId));
      ok = true;
    });
    return ok;
  }, [actors, detail, reloadCurrent, guard]);
  const onDeleteTask = useCallback(async (taskId: string) => {
    let ok = false;
    await guard(async () => {
      const you = actors.find((a) => a.type === 'human')?.id ?? 'admin';
      await api.deleteTask(taskId, you);
      setDetail(null);
      const n = ++nonce.current;
      setToast({ text: `已删除 ${taskId}`, n });
      await reloadCurrent();
      ok = true;
    });
    return ok;
  }, [actors, reloadCurrent, guard]);
  const onComment = useCallback((taskId: string, body: string) => guard(async () => {
    const you = actors.find((a) => a.type === 'human')?.id ?? 'admin';
    await api.comment(taskId, { actor: you, body });
    await reloadCurrent();
    if (detail) setDetail(await api.task(detail.task.id));
  }), [actors, detail, reloadCurrent, guard]);
  const onReorder = useCallback((ids: string[]) => guard(async () => {
    await api.reorder(ids);
    await reloadCurrent();
  }), [guard, reloadCurrent]);

  const createControl = (kind: 'project' | 'task', placeholder: string, label: string) => (
    draft?.kind === kind ? (
      <form className="inline-create" onSubmit={(e) => { e.preventDefault(); submitDraft(); }}>
        <input autoFocus placeholder={placeholder}
          value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })}
          onKeyDown={(e) => { if (e.key === 'Escape') setDraft(null); }} />
        <button type="submit" className="btn primary">确定</button>
        <button type="button" className="btn" onClick={() => setDraft(null)}>取消</button>
      </form>
    ) : (
      <button className="btn" onClick={() => setDraft({ kind, title: '' })}>{label}</button>
    )
  );

  return (
    <div className="app">
      {error && (
        <div role="alert" className="error-banner" onClick={() => setError(null)}>
          ⚠ {error}(点击关闭)
        </div>
      )}
      <div className="topbar">
        <div className="brand">
          <button className="up-btn" onClick={ascend} disabled={!canAscend} aria-label="返回上一层" title="返回上一层">
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M7 14l5-5 5 5" /></svg>
          </button>
          Relay
        </div>
        {view === 'board' && (
          <nav className="crumb" aria-label="层级">
            {atRoot ? <span className="crumb-cur">项目总览</span> : (
              <>
                <button className="crumb-link" onClick={() => jumpTo(-1)}>项目总览</button>
                <span className="crumb-sep">▸</span>
                <ProjectPicker projects={projects} value={path[0].id} onChange={changeFilter} />
                {path.slice(1).map((n, i) => {
                  const idx = i + 1;
                  return (
                    <span key={n.id} className="crumb-seg">
                      <span className="crumb-sep">▸</span>
                      {idx < path.length - 1
                        ? <button className="crumb-link" onClick={() => jumpTo(idx)}>{n.title}</button>
                        : <span className="crumb-cur">{n.title}</span>}
                    </span>
                  );
                })}
              </>
            )}
          </nav>
        )}
        <div className="topbar-right">
          {pendingTotal > 0 && (
            <button className="attn-pill" onClick={() => { setView('board'); changeFilter('all'); }}>
              🔔 待你处理 {pendingTotal}
            </button>
          )}
          <div className="tabs">
            <button className={`tab${view === 'board' ? ' active' : ''}`} onClick={() => setView('board')}>看板</button>
            <button className={`tab${view === 'tree' ? ' active' : ''}`} onClick={() => setView('tree')}>任务树</button>
          </div>
          {view === 'board' && atRoot && createControl('project', '项目标题…', '+ 新建项目')}
          {view === 'board' && canCreateTask && createControl('task', '任务标题…', '+ 追加任务')}
        </div>
      </div>

      {!loaded && !error && <div className="board-empty">加载中…</div>}
      {loaded && view === 'board' && (atRoot ? (
        <Board columns={projectCols} actorsById={actorsById}
          onOpen={(id) => { const p = projects.find((x) => x.id === id); if (p) enterProject(p); }}
          onReorder={onReorder}
          emptyHint={<><b>还没有项目</b><div>点右上角「+ 新建项目」开始</div></>} />
      ) : (
        <Board columns={taskCols} actorsById={actorsById} onOpen={openTask} onReorder={onReorder} flashId={flash?.id ?? null}
          // 只有已在某项目内才允许继续下钻 —— 从"全部任务"钻入会让 path[0] 成为非项目, 面包屑/上溯都乱套
          onDescend={isAll ? undefined : (id) => { const t = taskCols.flatMap((c) => c.tasks).find((x) => x.id === id); if (t) descend({ id: t.id, title: t.title }); }}
          showProject={isAll}
          emptyHint={<><b>还没有任务</b><div>{canCreateTask ? '点「+ 追加任务」添加' : '去某个项目里追加任务'}</div></>} />
      ))}
      {loaded && view === 'tree' && (tree.length > 0
        ? <Tree nodes={tree} onOpen={openTask} actorsById={actorsById} />
        : <div className="board-empty"><b>还没有任务</b><div>新建项目后,任务树会在这里展开</div></div>)}

      {/* live region 常驻 DOM, 只换文本 —— 容器与内容同时插入, 读屏多半不播报 */}
      <div className="toast-region" role="status" aria-live="polite">
        {toast && <div className="toast" key={toast.n}>{toast.text}</div>}
      </div>

      {detail && (
        <>
          <div className="drawer-backdrop" onClick={closeDetail} aria-hidden="true" />
          <TaskDetail pkg={detail} actorsById={actorsById} onAnswer={onAnswer} onAct={onAct} onComment={onComment} onOpenTask={openTask} onUpdate={onUpdateTask} onDelete={onDeleteTask} routing={routing} onClose={closeDetail} />
        </>
      )}
    </div>
  );
}
