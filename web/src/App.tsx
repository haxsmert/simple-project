import { useEffect, useState, useCallback } from 'react';
import { api } from './api';
import type { BoardColumn, TaskNode, TaskPackage, Actor } from './types';
import { Board } from './components/Board';
import { Tree } from './components/Tree';
import { TaskDetail } from './components/TaskDetail';

export function App() {
  const [view, setView] = useState<'projects' | 'tasks' | 'tree'>('projects');
  const [filterProject, setFilterProject] = useState<string>('all'); // 'all' 或 项目 id
  const [projectCols, setProjectCols] = useState<BoardColumn[]>([]);
  const [taskCols, setTaskCols] = useState<BoardColumn[]>([]);
  const [tree, setTree] = useState<TaskNode[]>([]);
  const [actors, setActors] = useState<Actor[]>([]);
  const [detail, setDetail] = useState<TaskPackage | null>(null);
  const [error, setError] = useState<string | null>(null);

  const actorsById = Object.fromEntries(actors.map((a) => [a.id, a]));
  const projects = projectCols.flatMap((c) => c.tasks).map((t) => ({ id: t.id, title: t.title }));

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

  const newProject = useCallback(() => guard(async () => {
    const title = window.prompt('新项目标题');
    if (title) { await api.createTask({ title }); await refresh(); }
  }), [refresh, guard]);

  const addTask = useCallback(() => guard(async () => {
    if (filterProject === 'all') return;
    const title = window.prompt('追加任务标题');
    if (title) { await api.createTask({ title, parentId: filterProject }); await loadTaskBoard(filterProject); await refresh(); }
  }), [guard, filterProject, loadTaskBoard, refresh]);

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
        {view === 'projects' && (
          <button className="btn" style={{ marginLeft: 'auto' }} onClick={newProject}>+ 新建项目</button>
        )}
      </div>

      {view === 'tasks' && (
        <div className="topbar">
          <label className="crumb" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            项目筛选
            <select value={filterProject} onChange={(e) => changeFilter(e.target.value)}>
              <option value="all">全部</option>
              {projects.map((p) => <option key={p.id} value={p.id}>{p.title}</option>)}
            </select>
          </label>
          {filterProject !== 'all' && (
            <button className="btn" style={{ marginLeft: 'auto' }} onClick={addTask}>+ 追加任务</button>
          )}
        </div>
      )}

      {view === 'projects' && (
        <Board columns={projectCols} actorsById={actorsById} onOpen={openProjectAsTasks}
          emptyHint={<><b>还没有项目</b><div>点右上角「+ 新建项目」开始</div></>} />
      )}
      {view === 'tasks' && (
        <Board columns={taskCols} actorsById={actorsById} onOpen={openTask}
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
