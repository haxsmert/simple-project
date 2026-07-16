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

  it('board 把每个任务富化成 BoardCard: 子任务计数 + 关系边', () => {
    const { db, service } = svc();
    createTask(db, { id: 'R-10', title: '有子任务与依赖的任务', state: 'executing' });
    createTask(db, { id: 'R-11', title: '子任务1', parentId: 'R-10', state: 'done' });
    createTask(db, { id: 'R-12', title: '子任务2', parentId: 'R-10', state: 'executing' });
    createTask(db, { id: 'R-13', title: '被依赖任务', state: 'done' });
    service.linkEdge({ fromTask: 'R-10', toTask: 'R-13', type: 'depends_on' });

    const board = service.board();
    const card = board.find((c) => c.state === 'executing')!.tasks.find((t) => t.id === 'R-10')!;
    expect(card.subtaskCount).toBe(2);
    expect(card.doneSubtaskCount).toBe(1);
    expect(card.edges.out.map((e) => e.type)).toEqual(['depends_on']);
    expect(card.edges.out[0].toTask).toBe('R-13');
    expect(card.edges.in).toEqual([]);
  });

  it('projectBoard 只按状态分组顶层任务(项目), 不含子任务/孙任务', () => {
    const { db, service } = svc();
    createTask(db, { id: 'R-20', title: '项目', state: 'planning' });
    createTask(db, { id: 'R-21', title: '任务1', parentId: 'R-20', state: 'executing' });
    createTask(db, { id: 'R-22', title: '任务2', parentId: 'R-20', state: 'done' });
    createTask(db, { id: 'R-23', title: '孙任务', parentId: 'R-21', state: 'planning' });

    const board = service.projectBoard();
    expect(board.map((c) => c.state)).toEqual(STATE_ORDER);
    const allIds = board.flatMap((c) => c.tasks.map((t) => t.id));
    expect(allIds).toEqual(['R-20']);
    expect(allIds).not.toContain('R-21');
    expect(allIds).not.toContain('R-22');
    expect(allIds).not.toContain('R-23');

    const card = board.find((c) => c.state === 'planning')!.tasks.find((t) => t.id === 'R-20')!;
    expect(card.subtaskCount).toBe(2);
    expect(card.doneSubtaskCount).toBe(1);
    expect(card.edges).toEqual({ out: [], in: [] });
  });

  it('taskBoard(projectId) 只按状态分组该项目的直接子任务, 不含孙任务', () => {
    const { db, service } = svc();
    createTask(db, { id: 'R-30', title: '项目', state: 'planning' });
    createTask(db, { id: 'R-31', title: '任务1', parentId: 'R-30', state: 'executing' });
    createTask(db, { id: 'R-32', title: '任务2', parentId: 'R-30', state: 'done' });
    createTask(db, { id: 'R-33', title: '孙任务', parentId: 'R-31', state: 'planning' });

    const board = service.taskBoard('R-30');
    expect(board.map((c) => c.state)).toEqual(STATE_ORDER);
    const allIds = board.flatMap((c) => c.tasks.map((t) => t.id));
    expect(allIds.sort()).toEqual(['R-31', 'R-32']);
    expect(allIds).not.toContain('R-30');
    expect(allIds).not.toContain('R-33');

    const card = board.find((c) => c.state === 'executing')!.tasks.find((t) => t.id === 'R-31')!;
    expect(card.subtaskCount).toBe(1);
    expect(card.doneSubtaskCount).toBe(0);
  });
});
