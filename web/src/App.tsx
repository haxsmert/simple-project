import { useEffect, useState, useCallback } from 'react';
import { api } from './api';
import type { BoardColumn, TaskNode, TaskPackage, Actor } from './types';
import { Board } from './components/Board';
import { Tree } from './components/Tree';
import { TaskDetail } from './components/TaskDetail';

export function App() {
  const [view, setView] = useState<'board' | 'tree'>('board');
  const [board, setBoard] = useState<BoardColumn[]>([]);
  const [tree, setTree] = useState<TaskNode[]>([]);
  const [actors, setActors] = useState<Actor[]>([]);
  const [detail, setDetail] = useState<TaskPackage | null>(null);
  const [error, setError] = useState<string | null>(null);

  const actorsById = Object.fromEntries(actors.map((a) => [a.id, a]));

  const guard = useCallback(async (fn: () => Promise<void>) => {
    try { setError(null); await fn(); } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
  }, []);

  const refresh = useCallback(async () => {
    const [b, t, a] = await Promise.all([api.board(), api.tree(), api.actors()]);
    setBoard(b); setTree(t); setActors(a);
  }, []);
  useEffect(() => { guard(refresh); }, [refresh, guard]);

  const open = useCallback((id: string) => guard(async () => { setDetail(await api.task(id)); }), [guard]);
  const onAnswer = useCallback((clarId: string, answer: string) => guard(async () => {
    const you = actors.find((a) => a.type === 'human')?.id ?? 'you';
    await api.answer(clarId, { byActor: you, answer });
    await refresh();
    if (detail) setDetail(await api.task(detail.task.id));
  }), [actors, detail, refresh, guard]);
  const onHandoff = useCallback((input: { taskId: string; toActor: string; toRole: string; toState: string; note: string }) =>
    guard(async () => {
      const you = actors.find((a) => a.type === 'human')?.id ?? 'you';
      await api.handoff({ ...input, byActor: you });
      await refresh();
      if (detail) setDetail(await api.task(detail.task.id));
    }), [actors, detail, refresh, guard]);

  const onComment = useCallback((taskId: string, body: string) =>
    guard(async () => {
      const you = actors.find((a) => a.type === 'human')?.id ?? 'you';
      await api.comment(taskId, { actor: you, body });
      await refresh();
      if (detail) setDetail(await api.task(detail.task.id));
    }), [actors, detail, refresh, guard]);
  const create = useCallback(() => guard(async () => {
    const title = window.prompt('新任务标题');
    if (title) { await api.createTask({ title }); await refresh(); }
  }), [refresh, guard]);

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
          <button className={`tab${view === 'board' ? ' active' : ''}`} onClick={() => setView('board')}>看板</button>
          <button className={`tab${view === 'tree' ? ' active' : ''}`} onClick={() => setView('tree')}>任务树</button>
        </div>
        <button className="btn" style={{ marginLeft: 'auto' }} onClick={create}>+ 新建任务</button>
      </div>

      {view === 'board'
        ? <Board columns={board} actorsById={actorsById} onOpen={open} />
        : <Tree nodes={tree} onOpen={open} />}

      {detail && (
        <TaskDetail pkg={detail} actorsById={actorsById} onAnswer={onAnswer} onHandoff={onHandoff} onComment={onComment} onClose={() => setDetail(null)} />
      )}
    </div>
  );
}
