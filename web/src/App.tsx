import { useEffect, useState, useCallback } from 'react';
import { api } from './api';
import type { BoardColumn, TaskNode, TaskPackage, Actor } from './types';
import { Board } from './components/Board';
import { Tree } from './components/Tree';
import { TaskDetail } from './components/TaskDetail';

export function App() {
  const [view, setView] = useState<'projects' | 'tree'>('projects');
  const [selectedProject, setSelectedProject] = useState<{ id: string; title: string } | null>(null);
  const [projectCols, setProjectCols] = useState<BoardColumn[]>([]);
  const [taskCols, setTaskCols] = useState<BoardColumn[]>([]);
  const [tree, setTree] = useState<TaskNode[]>([]);
  const [actors, setActors] = useState<Actor[]>([]);
  const [detail, setDetail] = useState<TaskPackage | null>(null);
  const [error, setError] = useState<string | null>(null);

  const actorsById = Object.fromEntries(actors.map((a) => [a.id, a]));

  const guard = useCallback(async (fn: () => Promise<void>) => {
    try { setError(null); await fn(); } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
  }, []);

  const refresh = useCallback(async () => {
    const [p, t, a] = await Promise.all([api.projects(), api.tree(), api.actors()]);
    setProjectCols(p); setTree(t); setActors(a);
  }, []);
  useEffect(() => { guard(refresh); }, [refresh, guard]);

  // 详情抽屉: Esc 关闭
  useEffect(() => {
    if (!detail) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setDetail(null); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [detail]);

  const loadTasks = useCallback(async (projectId: string) => {
    setTaskCols(await api.projectBoard(projectId));
  }, []);

  const openProject = useCallback((id: string) => guard(async () => {
    const title = projectCols.flatMap((c) => c.tasks).find((t) => t.id === id)?.title ?? id;
    setSelectedProject({ id, title });
    await loadTasks(id);
  }), [guard, projectCols, loadTasks]);

  const openTask = useCallback((id: string) => guard(async () => { setDetail(await api.task(id)); }), [guard]);

  const backToProjects = useCallback(() => { setSelectedProject(null); setDetail(null); }, []);

  const newProject = useCallback(() => guard(async () => {
    const title = window.prompt('新项目标题');
    if (title) { await api.createTask({ title }); await refresh(); }
  }), [refresh, guard]);

  const addTask = useCallback(() => guard(async () => {
    const title = window.prompt('追加任务标题');
    if (title) {
      await api.createTask({ title, parentId: selectedProject!.id });
      await loadTasks(selectedProject!.id);
      await refresh();
    }
  }), [guard, selectedProject, loadTasks, refresh]);

  const onAnswer = useCallback((clarId: string, answer: string) => guard(async () => {
    const you = actors.find((a) => a.type === 'human')?.id ?? 'you';
    await api.answer(clarId, { byActor: you, answer });
    await refresh();
    if (selectedProject) await loadTasks(selectedProject.id);
    if (detail) setDetail(await api.task(detail.task.id));
  }), [actors, detail, refresh, guard, selectedProject, loadTasks]);
  const onHandoff = useCallback((input: { taskId: string; toActor: string; toRole: string; toState: string; note: string }) =>
    guard(async () => {
      const you = actors.find((a) => a.type === 'human')?.id ?? 'you';
      await api.handoff({ ...input, byActor: you });
      await refresh();
      if (selectedProject) await loadTasks(selectedProject.id);
      if (detail) setDetail(await api.task(detail.task.id));
    }), [actors, detail, refresh, guard, selectedProject, loadTasks]);

  const onComment = useCallback((taskId: string, body: string) =>
    guard(async () => {
      const you = actors.find((a) => a.type === 'human')?.id ?? 'you';
      await api.comment(taskId, { actor: you, body });
      await refresh();
      if (selectedProject) await loadTasks(selectedProject.id);
      if (detail) setDetail(await api.task(detail.task.id));
    }), [actors, detail, refresh, guard, selectedProject, loadTasks]);

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
          <button className={`tab${view === 'tree' ? ' active' : ''}`} onClick={() => setView('tree')}>任务树</button>
        </div>
        {view === 'projects' && !selectedProject && (
          <button className="btn" style={{ marginLeft: 'auto' }} onClick={newProject}>+ 新建项目</button>
        )}
      </div>

      {view === 'projects' && selectedProject && (
        <div className="topbar">
          <span className="crumb" style={{ cursor: 'pointer' }} onClick={backToProjects}>
            ← 项目 ▸ {selectedProject.title}
          </span>
          <button className="btn" style={{ marginLeft: 'auto' }} onClick={addTask}>+ 追加任务</button>
        </div>
      )}

      {view === 'projects'
        ? (selectedProject
          ? <Board columns={taskCols} actorsById={actorsById} onOpen={openTask} />
          : <Board columns={projectCols} actorsById={actorsById} onOpen={openProject} />)
        : <Tree nodes={tree} onOpen={openTask} />}

      {detail && (
        <>
          <div className="drawer-backdrop" onClick={() => setDetail(null)} aria-hidden="true" />
          <TaskDetail pkg={detail} actorsById={actorsById} onAnswer={onAnswer} onHandoff={onHandoff} onComment={onComment} onClose={() => setDetail(null)} />
        </>
      )}
    </div>
  );
}
