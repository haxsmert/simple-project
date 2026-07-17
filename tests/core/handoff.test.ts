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
    })).toThrow(/非法流转/);
  });

  // 产品约定: 确认关可以跳过, 但计划不能跳过 —— 从待规划推进(去执行或去确认)前必须有计划
  it('从待规划推进必须有计划: 两条路(直接开工/先过确认)都拦, 同态改派不拦, 写了计划就放行', () => {
    const db = openDb(':memory:');
    createActor(db, { id: 'p', name: 'P', type: 'agent' });
    const bare = createTask(db, { title: '没计划', state: 'planning', currentActor: 'p', currentRole: 'planner' });
    expect(() => handoff(db, { taskId: bare.id, byActor: 'p', toActor: 'p', toRole: 'executor', toState: 'executing' }))
      .toThrow(/还没有计划/);
    expect(() => handoff(db, { taskId: bare.id, byActor: 'p', toActor: 'p', toRole: 'decider', toHold: 'confirm' }))
      .toThrow(/还没有计划/);
    // 同态改派(planning→planning)不是推进, 不该被计划守卫拦下 —— 换人接手规划正是常见路径
    createActor(db, { id: 'q', name: 'Q', type: 'agent' });
    expect(() => handoff(db, { taskId: bare.id, byActor: 'p', toActor: 'q', toRole: 'planner' })).not.toThrow();
    // 空白字符不算计划
    const blank = createTask(db, { title: '空白计划', state: 'planning', currentActor: 'p', currentRole: 'planner', inputsMd: '  \n ' });
    expect(() => handoff(db, { taskId: blank.id, byActor: 'p', toActor: 'p', toRole: 'executor', toState: 'executing' }))
      .toThrow(/还没有计划/);
    const planned = createTask(db, { title: '有计划', state: 'planning', currentActor: 'p', currentRole: 'planner', inputsMd: '- [ ] 第一步' });
    expect(handoff(db, { taskId: planned.id, byActor: 'p', toActor: 'p', toRole: 'executor', toState: 'executing' }).state)
      .toBe('executing');
  });
});
