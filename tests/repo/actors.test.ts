import { describe, it, expect } from 'vitest';
import { openDb } from '../../src/db/connection';
import { createActor, getActor, listActors } from '../../src/repo/actors';

describe('actors repo', () => {
  it('创建人和 agent, 可取回、可按类型列出', () => {
    const db = openDb(':memory:');
    createActor(db, { id: 'admin', name: 'admin', type: 'human' });
    createActor(db, { id: 'agent-exec-a', name: '执行·A', type: 'agent', handle: 'mcp:exec-a' });

    const admin = getActor(db, 'admin');
    expect(admin?.name).toBe('admin');
    expect(admin?.type).toBe('human');
    expect(admin?.handle).toBeNull();

    expect(getActor(db, 'agent-exec-a')?.handle).toBe('mcp:exec-a');
    expect(listActors(db).length).toBe(2);
    expect(listActors(db, 'agent').map((a) => a.id)).toEqual(['agent-exec-a']);
  });
});
