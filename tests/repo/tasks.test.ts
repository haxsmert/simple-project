import { describe, it, expect } from 'vitest';
import { openDb } from '../../src/db/connection';
import {
  createTask, getTask, updateTask, listChildren, listRoots, ancestors, nextTaskId,
} from '../../src/repo/tasks';

describe('tasks repo', () => {
  it('创建根/子任务, ID 递增, 支持递归查询', () => {
    const db = openDb(':memory:');
    const root = createTask(db, { title: '项目' });
    expect(root.id).toBe('R-1');
    expect(root.state).toBe('planning');

    const child = createTask(db, { title: '子任务', parentId: root.id });
    expect(child.id).toBe('R-2');
    expect(nextTaskId(db)).toBe('R-3');

    const grand = createTask(db, { title: '孙任务', parentId: child.id });

    expect(listRoots(db).map((t) => t.id)).toEqual(['R-1']);
    expect(listChildren(db, root.id).map((t) => t.id)).toEqual(['R-2']);
    expect(ancestors(db, grand.id).map((t) => t.id)).toEqual(['R-1', 'R-2']);
  });

  it('更新字段并推进 updated_at', () => {
    const db = openDb(':memory:');
    const t = createTask(db, { title: 'x' });
    const before = t.updatedAt;
    const u = updateTask(db, t.id, { state: 'executing', summary: '干起来了' });
    expect(u.state).toBe('executing');
    expect(u.summary).toBe('干起来了');
    expect(u.updatedAt >= before).toBe(true);
    expect(getTask(db, t.id)?.state).toBe('executing');
  });

  it('子任务按数字后缀排序(R-10 不排在 R-2 前)', () => {
    const db = openDb(':memory:');
    const root = createTask(db, { title: 'root' }); // R-1
    const ids: string[] = [];
    for (let i = 0; i < 10; i++) ids.push(createTask(db, { title: `c${i}`, parentId: root.id }).id); // R-2..R-11
    expect(listChildren(db, root.id).map((t) => t.id)).toEqual(ids); // 数字序, 非字符串序
  });
});
