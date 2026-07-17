import { useEffect, useState, useCallback, useRef } from 'react';
import { api } from './api';
import type { BoardColumn, TaskNode, TaskPackage, Actor } from './types';
import { Board } from './components/Board';
import { Tree } from './components/Tree';
import { TaskDetail } from './components/TaskDetail';
import { ProjectPicker } from './components/ProjectPicker';

type NavNode = { id: string; title: string };

export function App() {
  const [view, setView] = useState<'projects' | 'tasks' | 'tree'>('projects');
  // 导航路径栈: [] = 项目总览(顶层); [项目] = 该项目的任务; [项目,任务] = 该任务的子任务 …… 任意深度即递归树
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
  const currentId = path.length ? path[path.length - 1].id : null; // 当前看板所属节点; null = 全部任务
  const canAscend = view === 'tasks'; // 只有在(递归的)任务看板里才有"上一层"可去

  const guard = useCallback(async (fn: () => Promise<void>) => {
    try { setError(null); await fn(); } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
  }, []);

  const refresh = useCallback(async () => {
    const [p, t, a] = await Promise.all([api.projects(), api.tree(), api.actors()]);
    setProjectCols(p); setTree(t); setActors(a);
  }, []);
  // 首屏无论成败都置 loaded: 成功→出看板, 失败→出错误横幅+可导航的空看板, 绝不因失败卡死在"加载中…"
  useEffect(() => { guard(refresh).finally(() => setLoaded(true)); }, [refresh, guard]);

  useEffect(() => {
    if (!detail) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') closeDetail(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [detail, closeDetail]);

  // 当前节点的子任务看板; nodeId 为 null 取全部任务
  const loadBoard = useCallback(async (nodeId: string | null) => {
    setTaskCols(nodeId ? await api.taskBoard(nodeId) : await api.allTasks());
  }, []);

  // 项目总览点项目 → 钻进它的任务(路径栈 = [项目])
  const openProjectAsTasks = useCallback((project: NavNode) => guard(async () => {
    setPath([project]); setView('tasks'); await loadBoard(project.id);
  }), [guard, loadBoard]);

  // 钻入一个任务的子任务(路径栈 +1 层) —— 递归下钻的落点
  const descend = useCallback((node: NavNode) => guard(async () => {
    setPath((p) => [...p, node]); await loadBoard(node.id);
  }), [guard, loadBoard]);

  // 上一层: 任务看板里逐层弹回, 弹到底回到项目总览; 顶层/树视图无处可上
  const ascend = useCallback(() => guard(async () => {
    if (view !== 'tasks') return;
    if (path.length >= 2) { const np = path.slice(0, -1); setPath(np); await loadBoard(np[np.length - 1].id); }
    else { setPath([]); setView('projects'); }
  }), [guard, loadBoard, view, path]);

  // 面包屑跳转: index=-1 回项目总览; 否则截断到 path[0..index]
  const jumpTo = useCallback((index: number) => guard(async () => {
    if (index < 0) { setPath([]); setView('projects'); return; }
    const np = path.slice(0, index + 1); setPath(np); await loadBoard(np[np.length - 1].id);
  }), [guard, loadBoard, path]);

  const gotoTasks = useCallback(() => guard(async () => { setView('tasks'); await loadBoard(currentId); }), [guard, loadBoard, currentId]);
  // 项目选择器: 快速跳到某项目(重置路径为该项目)或全部任务
  const changeFilter = useCallback((f: string) => guard(async () => {
    if (f === 'all') { setPath([]); await loadBoard(null); }
    else { const p = projects.find((x) => x.id === f); setPath(p ? [p] : []); await loadBoard(f); }
  }), [guard, loadBoard, projects]);

  const openTask = useCallback((id: string) => {
    triggerRef.current = document.activeElement as HTMLElement; // 记住触发卡片, 供关闭时归还焦点
    return guard(async () => { setDetail(await api.task(id)); });
  }, [guard]);

  const reloadCurrent = useCallback(async () => {
    await refresh();
    if (view === 'tasks') await loadBoard(currentId);
  }, [refresh, view, loadBoard, currentId]);

  const submitDraft = useCallback(() => guard(async () => {
    if (!draft || !draft.title.trim()) { setDraft(null); return; }
    if (draft.kind === 'project') { await api.createTask({ title: draft.title.trim() }); }
    else { await api.createTask({ title: draft.title.trim(), parentId: currentId ?? undefined }); await loadBoard(currentId); }
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
        <div className="tabs">
          <button className={`tab${view === 'projects' ? ' active' : ''}`} onClick={() => setView('projects')}>项目</button>
          <button className={`tab${view === 'tasks' ? ' active' : ''}`} onClick={gotoTasks}>任务</button>
          <button className={`tab${view === 'tree' ? ' active' : ''}`} onClick={() => setView('tree')}>任务树</button>
        </div>
        {pendingTotal > 0 && (
          <button className="attn-pill" onClick={() => { setView('tasks'); changeFilter('all'); }}>
            🔔 待你处理 {pendingTotal}
          </button>
        )}
        {view === 'projects' && (
          draft?.kind === 'project' ? (
            <form className="inline-create" style={{ marginLeft: 'auto' }} onSubmit={(e) => { e.preventDefault(); submitDraft(); }}>
              <input autoFocus placeholder="项目标题…"
                value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })}
                onKeyDown={(e) => { if (e.key === 'Escape') setDraft(null); }} />
              <button type="submit" className="btn primary">确定</button>
              <button type="button" className="btn" onClick={() => setDraft(null)}>取消</button>
            </form>
          ) : (
            <button className="btn" style={{ marginLeft: 'auto' }} onClick={() => setDraft({ kind: 'project', title: '' })}>+ 新建项目</button>
          )
        )}
      </div>

      {view === 'tasks' && (
        <div className="topbar">
          <nav className="crumb" aria-label="层级">
            <button className="crumb-link" onClick={() => jumpTo(-1)}>项目总览</button>
            <span className="crumb-sep">▸</span>
            {/* 项目那一格 = 可切换的选择器(既是路径, 又能横跳到别的项目); 更深的层级才是纯钻取路径 */}
            <ProjectPicker projects={projects} value={path[0]?.id ?? 'all'} onChange={changeFilter} />
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
          </nav>
          {currentId && (
            draft?.kind === 'task' ? (
              <form className="inline-create" style={{ marginLeft: 'auto' }} onSubmit={(e) => { e.preventDefault(); submitDraft(); }}>
                <input autoFocus placeholder="任务标题…"
                  value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })}
                  onKeyDown={(e) => { if (e.key === 'Escape') setDraft(null); }} />
                <button type="submit" className="btn primary">确定</button>
                <button type="button" className="btn" onClick={() => setDraft(null)}>取消</button>
              </form>
            ) : (
              <button className="btn" style={{ marginLeft: 'auto' }} onClick={() => setDraft({ kind: 'task', title: '' })}>+ 追加任务</button>
            )
          )}
        </div>
      )}

      {!loaded && !error && <div className="board-empty">加载中…</div>}
      {loaded && view === 'projects' && (
        <Board columns={projectCols} actorsById={actorsById}
          onOpen={(id) => { const p = projects.find((x) => x.id === id); if (p) openProjectAsTasks(p); }}
          onReorder={onReorder}
          emptyHint={<><b>还没有项目</b><div>点右上角「+ 新建项目」开始</div></>} />
      )}
      {loaded && view === 'tasks' && (
        <Board columns={taskCols} actorsById={actorsById} onOpen={openTask} onReorder={onReorder}
          onDescend={(id) => { const t = taskCols.flatMap((c) => c.tasks).find((x) => x.id === id); if (t) descend({ id: t.id, title: t.title }); }}
          emptyHint={<><b>还没有任务</b><div>{currentId ? '点「+ 追加任务」添加' : '去某个项目里追加任务'}</div></>} />
      )}
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
