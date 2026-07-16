import { useEffect, useState } from 'react';
import { api } from './api';
import type { BoardColumn } from './types';

export function App() {
  const [board, setBoard] = useState<BoardColumn[]>([]);
  useEffect(() => { api.board().then(setBoard).catch(() => {}); }, []);
  return (
    <div>
      <h1>Relay</h1>
      <ul>
        {board.flatMap((c) => c.tasks).map((t) => <li key={t.id}>{t.title}</li>)}
      </ul>
    </div>
  );
}
