import { describe, it, expect } from 'vitest';
import { openDb } from '../../src/db/connection';
import { createTask } from '../../src/repo/tasks';
import { createActor } from '../../src/repo/actors';
import { appendEvent, listEvents } from '../../src/repo/events';

describe('events repo', () => {
  it('追加事件并按插入顺序返回', () => {
    const db = openDb(':memory:');
    createActor(db, { id: 'admin', name: 'admin', type: 'human' });
    const t = createTask(db, { title: 'T' });

    appendEvent(db, { taskId: t.id, actorId: 'admin', kind: 'claim' });
    appendEvent(db, {
      taskId: t.id, actorId: 'admin', kind: 'handoff',
      roleFrom: 'planner', roleTo: 'executor', body: '交给执行者',
    });

    const evs = listEvents(db, t.id);
    expect(evs.map((e) => e.kind)).toEqual(['claim', 'handoff']);
    expect(evs[1].roleFrom).toBe('planner');
    expect(evs[1].roleTo).toBe('executor');
    expect(evs[1].body).toBe('交给执行者');
  });
});
