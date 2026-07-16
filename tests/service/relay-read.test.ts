import { describe, it, expect } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDb } from '../../src/db/connection';
import { createActor } from '../../src/repo/actors';
import { createTask } from '../../src/repo/tasks';
import { RelayService, STATE_ORDER } from '../../src/service/relay';

function svc() {
  const db = openDb(':memory:');
  const dir = mkdtempSync(join(tmpdir(), 'relay-svc-'));
  return { db, service: new RelayService(db, dir) };
}

describe('RelayService reads', () => {
  it('board 按六态顺序分组全部任务', () => {
    const { db, service } = svc();
    createTask(db, { id: 'R-1', title: '根', state: 'executing' });
    createTask(db, { id: 'R-2', title: '子', parentId: 'R-1', state: 'done' });
    const board = service.board();
    expect(board.map((c) => c.state)).toEqual(STATE_ORDER);
    expect(board.find((c) => c.state === 'executing')!.tasks.map((t) => t.id)).toEqual(['R-1']);
    expect(board.find((c) => c.state === 'done')!.tasks.map((t) => t.id)).toEqual(['R-2']);
  });

  it('tree 递归嵌套子任务', () => {
    const { db, service } = svc();
    createTask(db, { id: 'R-1', title: '根' });
    createTask(db, { id: 'R-2', title: '子', parentId: 'R-1' });
    createTask(db, { id: 'R-3', title: '孙', parentId: 'R-2' });
    const tree = service.tree();
    expect(tree.map((n) => n.id)).toEqual(['R-1']);
    expect(tree[0].children[0].id).toBe('R-2');
    expect(tree[0].children[0].children[0].id).toBe('R-3');
  });

  it('listByActor 可按角色过滤', () => {
    const { db, service } = svc();
    createActor(db, { id: 'a', name: 'A', type: 'agent' });
    createTask(db, { id: 'R-1', title: 't1', currentActor: 'a', currentRole: 'executor' });
    createTask(db, { id: 'R-2', title: 't2', currentActor: 'a', currentRole: 'tester' });
    expect(service.listByActor('a').map((t) => t.id).sort()).toEqual(['R-1', 'R-2']);
    expect(service.listByActor('a', 'tester').map((t) => t.id)).toEqual(['R-2']);
  });
});
