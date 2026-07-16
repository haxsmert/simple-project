import { describe, it, expect } from 'vitest';
import { openDb } from '../../src/db/connection';
import { createActor } from '../../src/repo/actors';
import { createTask, getTask } from '../../src/repo/tasks';
import { listEvents } from '../../src/repo/events';
import { handoff } from '../../src/core/handoff';

describe('handoff', () => {
  it('换手改变负责人/角色/状态, 并留下换手记录', () => {
    const db = openDb(':memory:');
    createActor(db, { id: 'exec', name: '执行·A', type: 'agent' });
    createActor(db, { id: 'test', name: '测试·T', type: 'agent' });
    const t = createTask(db, {
      title: '搭建数据层', state: 'executing',
      currentActor: 'exec', currentRole: 'executor', outputsMd: '产物: schema.sql',
    });

    const after = handoff(db, {
      taskId: t.id, byActor: 'exec', toActor: 'test', toRole: 'tester', toState: 'testing', note: '交付验收',
    });

    expect(after.currentActor).toBe('test');
    expect(after.currentRole).toBe('tester');
    expect(after.state).toBe('testing');
    // 上一棒的产出原样保留 —— 成为测试者的输入
    expect(after.outputsMd).toBe('产物: schema.sql');

    const ev = listEvents(db, t.id).at(-1)!;
    expect(ev.kind).toBe('handoff');
    expect(ev.roleFrom).toBe('executor');
    expect(ev.roleTo).toBe('tester');
  });

  it('拒绝非法状态流转', () => {
    const db = openDb(':memory:');
    createActor(db, { id: 'exec', name: 'A', type: 'agent' });
    const t = createTask(db, { title: 'x', state: 'executing', currentActor: 'exec', currentRole: 'executor' });
    expect(() => handoff(db, {
      taskId: t.id, byActor: 'exec', toActor: 'exec', toRole: 'tester', toState: 'done',
    })).toThrow(/非法状态流转/);
  });
});
