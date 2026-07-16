import { describe, it, expect } from 'vitest';
import { openDb } from '../../src/db/connection';
import { createTask } from '../../src/repo/tasks';
import { createEdge, edgesFrom, edgesTo } from '../../src/repo/edges';

describe('edges repo', () => {
  it('创建有向边, 可按 from/to 查询', () => {
    const db = openDb(':memory:');
    const a = createTask(db, { title: 'A' });
    const b = createTask(db, { title: 'B' });
    createEdge(db, { fromTask: a.id, toTask: b.id, type: 'depends_on' });

    const out = edgesFrom(db, a.id);
    expect(out.length).toBe(1);
    expect(out[0].type).toBe('depends_on');
    expect(out[0].toTask).toBe(b.id);

    const inb = edgesTo(db, b.id);
    expect(inb[0].fromTask).toBe(a.id);
    expect(edgesFrom(db, b.id)).toEqual([]);
  });
});
