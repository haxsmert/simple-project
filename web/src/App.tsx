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

  const actorsById = Object.fromEntries(actors.map((a) => [a.id, a]));

  const refresh = useCallback(async () => {
    const [b, t, a] = await Promise.all([api.board(), api.tree(), api.actors()]);
    setBoard(b); setTree(t); setActors(a);
  }, []);
  useEffect(() => { refresh().catch(() => {}); }, [refresh]);

  const open = useCallback(async (id: string) => { setDetail(await api.task(id)); }, []);
  const onAnswer = useCallback(async (clarId: string, answer: string) => {
    const you = actors.find((a) => a.type === 'human')?.id ?? 'you';
    await api.answer(clarId, { byActor: you, answer });
    await refresh();
    if (detail) setDetail(await api.task(detail.task.id));
  }, [actors, detail, refresh]);
  const create = useCallback(async () => {
    const title = window.prompt('新任务标题');
    if (title) { await api.createTask({ title }); await refresh(); }
  }, [refresh]);

  return (
    <div className="app">
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
        <TaskDetail pkg={detail} actorsById={actorsById} onAnswer={onAnswer} onClose={() => setDetail(null)} />
      )}
    </div>
  );
}
