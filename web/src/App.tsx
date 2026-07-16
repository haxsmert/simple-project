import { useEffect, useState, useCallback } from 'react';
import { api } from './api';
import type { BoardColumn, TaskNode, TaskPackage, Actor } from './types';
import { Board } from './components/Board';
import { Tree } from './components/Tree';
import { TaskDetail } from './components/TaskDetail';
import { ProjectPicker } from './components/ProjectPicker';

export function App() {
  const [view, setView] = useState<'projects' | 'tasks' | 'tree'>('projects');
  const [filterProject, setFilterProject] = useState<string>('all'); // 'all' 或 项目 id
  const [projectCols, setProjectCols] = useState<BoardColumn[]>([]);
  const [taskCols, setTaskCols] = useState<BoardColumn[]>([]);
  const [tree, setTree] = useState<TaskNode[]>([]);
  const [actors, setActors] = useState<Actor[]>([]);
  const [detail, setDetail] = useState<TaskPackage | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState<{ kind: 'project' | 'task'; title: string } | null>(null);

  const actorsById = Object.fromEntries(actors.map((a) => [a.id, a]));
  const projects = projectCols.flatMap((c) => c.tasks).map((t) => ({ id: t.id, title: t.title }));
  const pendingTotal = projectCols.flatMap((c) => c.tasks).reduce((s, t) => s + (t.attention ?? 0), 0);

  const guard = useCallback(async (fn: () => Promise<void>) => {
    try { setError(null); await fn(); } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
  }, []);

  const refresh = useCallback(async () => {
    const [p, t, a] = await Promise.all([api.projects(), api.tree(), api.actors()]);
    setProjectCols(p); setTree(t); setActors(a);
  }, []);
  useEffect(() => { guard(refresh); }, [refresh, guard]);

  useEffect(() => {
    if (!detail) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setDetail(null); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [detail]);

  const loadTaskBoard = useCallback(async (filter: string) => {
    setTaskCols(filter === 'all' ? await api.allTasks() : await api.taskBoard(filter));
  }, []);

  // 项目看板点项目 → 跳到任务 tab 并带上该项目筛选
  const openProjectAsTasks = useCallback((projectId: string) => guard(async () => {
    setFilterProject(projectId);
    setView('tasks');
    await loadTaskBoard(projectId);
  }), [guard, loadTaskBoard]);

  const gotoTasks = useCallback(() => guard(async () => { setView('tasks'); await loadTaskBoard(filterProject); }), [guard, loadTaskBoard, filterProject]);
  const changeFilter = useCallback((f: string) => guard(async () => { setFilterProject(f); await loadTaskBoard(f); }), [guard, loadTaskBoard]);

  const openTask = useCallback((id: string) => guard(async () => { setDetail(await api.task(id)); }), [guard]);

  const reloadCurrent = useCallback(async () => {
    await refresh();
    if (view === 'tasks') await loadTaskBoard(filterProject);
  }, [refresh, view, loadTaskBoard, filterProject]);

  const submitDraft = useCallback(() => guard(async () => {
    if (!draft || !draft.title.trim()) { setDraft(null); return; }
    if (draft.kind === 'project') { await api.createTask({ title: draft.title.trim() }); }
    else { await api.createTask({ title: draft.title.trim(), parentId: filterProject }); await loadTaskBoard(filterProject); }
    await refresh();
    setDraft(null);
  }), [draft, filterProject, loadTaskBoard, refresh, guard]);

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
        <div className="brand"><span className="logo" />Relay</div>
        <div className="tabs">
          <button className={`tab${view === 'projects' ? ' active' : ''}`} onClick={() => setView('projects')}>项目</button>
          <button className={`tab${view === 'tasks' ? ' active' : ''}`} onClick={gotoTasks}>任务</button>
          <button className={`tab${view === 'tree' ? ' active' : ''}`} onClick={() => setView('tree')}>任务树</button>
        </div>
        {pendingTotal > 0 && (
          <button className="attn-pill" onClick={() => { setView('tasks'); changeFilter('all'); }}>
            🔔 待你决策 {pendingTotal}
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
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span className="crumb">任务看板 ▸</span>
            <ProjectPicker projects={projects} value={filterProject} onChange={changeFilter} />
          </div>
          {filterProject !== 'all' && (
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

      {view === 'projects' && (
        <Board columns={projectCols} actorsById={actorsById} onOpen={openProjectAsTasks} onReorder={onReorder}
          emptyHint={<><b>还没有项目</b><div>点右上角「+ 新建项目」开始</div></>} />
      )}
      {view === 'tasks' && (
        <Board columns={taskCols} actorsById={actorsById} onOpen={openTask} onReorder={onReorder}
          emptyHint={<><b>还没有任务</b><div>{filterProject === 'all' ? '去某个项目里追加任务' : '点「+ 追加任务」添加'}</div></>} />
      )}
      {view === 'tree' && <Tree nodes={tree} onOpen={openTask} />}

      {detail && (
        <>
          <div className="drawer-backdrop" onClick={() => setDetail(null)} aria-hidden="true" />
          <TaskDetail pkg={detail} actorsById={actorsById} onAnswer={onAnswer} onHandoff={onHandoff} onComment={onComment} onClose={() => setDetail(null)} />
        </>
      )}
    </div>
  );
}
