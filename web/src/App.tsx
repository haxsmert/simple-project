import { useEffect, useState, useCallback, useRef } from 'react';
import { api } from './api';
import type { BoardColumn, TaskNode, TaskPackage, Actor } from './types';
import { Board } from './components/Board';
import { Tree } from './components/Tree';
import { TaskDetail } from './components/TaskDetail';
import { ProjectPicker } from './components/ProjectPicker';

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
  const [detail, setDetail] = useState<TaskPackage | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false); // 首屏数据是否已到 —— 未到前不渲染空态, 避免误报"还没有项目"
  const [draft, setDraft] = useState<{ kind: 'project' | 'task'; title: string } | null>(null);
  const triggerRef = useRef<HTMLElement | null>(null); // 打开抽屉的那张卡, 关闭后把焦点还给它(键盘闭环)

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
    const [p, t, a] = await Promise.all([api.projects(), api.tree(), api.actors()]);
    setProjectCols(p); setTree(t); setActors(a);
  }, []);
  // 首屏无论成败都置 loaded: 成功→出看板, 失败→出错误横幅+可导航的空看板, 绝不因失败卡死在"加载中…"
  useEffect(() => { guard(refresh).finally(() => setLoaded(true)); }, [refresh, guard]);

  // 导航/视图一变就废弃未提交的新建草稿 —— 否则在项目 A 开的表单跳到项目 B 后提交, 会把任务建到 B 下
  useEffect(() => { setDraft(null); }, [path, view]);

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

  const openTask = useCallback((id: string) => {
    triggerRef.current = document.activeElement as HTMLElement; // 记住触发卡片, 供关闭时归还焦点
    return guard(async () => { setDetail(await api.task(id)); });
  }, [guard]);

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
    const you = actors.find((a) => a.type === 'human')?.id ?? 'you';
    await api.answer(clarId, { byActor: you, answer });
    await reloadCurrent();
    if (detail) setDetail(await api.task(detail.task.id));
  }), [actors, detail, reloadCurrent, guard]);
  const onHandoff = useCallback((input: { taskId: string; toActor: string; toRole: string; toState: string; note: string }) =>
    guard(async () => {
      const you = actors.find((a) => a.type === 'human')?.id ?? 'you';
      await api.handoff({ ...input, byActor: you });
      await reloadCurrent();
      if (detail) setDetail(await api.task(detail.task.id));
    }), [actors, detail, reloadCurrent, guard]);
  const onComment = useCallback((taskId: string, body: string) => guard(async () => {
    const you = actors.find((a) => a.type === 'human')?.id ?? 'you';
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
        <div role="alert" onClick={() => setError(null)}
          style={{ background: 'var(--danger-soft)', color: 'var(--danger)', border: '1px solid var(--danger)', borderRadius: 8, padding: '8px 12px', marginBottom: 12, cursor: 'pointer', fontSize: 13 }}>
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
        <Board columns={taskCols} actorsById={actorsById} onOpen={openTask} onReorder={onReorder}
          // 只有已在某项目内才允许继续下钻 —— 从"全部任务"钻入会让 path[0] 成为非项目, 面包屑/上溯都乱套
          onDescend={isAll ? undefined : (id) => { const t = taskCols.flatMap((c) => c.tasks).find((x) => x.id === id); if (t) descend({ id: t.id, title: t.title }); }}
          showProject={isAll}
          emptyHint={<><b>还没有任务</b><div>{canCreateTask ? '点「+ 追加任务」添加' : '去某个项目里追加任务'}</div></>} />
      ))}
      {loaded && view === 'tree' && (tree.length > 0
        ? <Tree nodes={tree} onOpen={openTask} actorsById={actorsById} />
        : <div className="board-empty"><b>还没有任务</b><div>新建项目后,任务树会在这里展开</div></div>)}

      {detail && (
        <>
          <div className="drawer-backdrop" onClick={closeDetail} aria-hidden="true" />
          <TaskDetail pkg={detail} actorsById={actorsById} onAnswer={onAnswer} onHandoff={onHandoff} onComment={onComment} onClose={closeDetail} />
        </>
      )}
    </div>
  );
}
