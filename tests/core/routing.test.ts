import { describe, it, expect } from 'vitest';
import { openDb } from '../../src/db/connection';
import { createActor } from '../../src/repo/actors';
import { createTask, updateTask } from '../../src/repo/tasks';
import { suggestActorForRole, routingTable } from '../../src/core/routing';

function db0() {
  const db = openDb(':memory:');
  createActor(db, { id: 'you', name: '你', type: 'human' });
  createActor(db, { id: 'ex-a', name: '执行·A', type: 'agent' });
  createActor(db, { id: 'test-t', name: '测试·T', type: 'agent' });
  return db;
}

describe('默认路由(角色 → 默认派给谁)', () => {
  it('规则是行为性的: 最近谁在扮演这个角色, 就默认还派给谁', () => {
    const db = db0();
    createTask(db, { id: 'R-1', title: 't1', state: 'testing', currentActor: 'test-t', currentRole: 'tester' });
    expect(suggestActorForRole(db, 'tester')).toBe('test-t');
    expect(suggestActorForRole(db, 'executor')).toBe('ex-a'); // 没人做过执行 → 兜底给 agent
  });

  it('同一 agent 可以在不同任务扮演不同角色(角色不绑死在 actor 上), 路由跟着最近的实际分工走', () => {
    const db = db0();
    createTask(db, { id: 'R-1', title: 't1', state: 'executing', currentActor: 'ex-a', currentRole: 'executor' });
    createTask(db, { id: 'R-2', title: 't2', state: 'testing', currentActor: 'ex-a', currentRole: 'tester' });
    expect(suggestActorForRole(db, 'tester')).toBe('ex-a'); // 执行·A 这次当了测试者 → 测试默认派给它
    // 后来测试·T 接了测试的活 → 默认应改判给它(取最近)
    updateTask(db, 'R-2', { currentActor: 'test-t' });
    expect(suggestActorForRole(db, 'tester')).toBe('test-t');
  });

  it('决策没历史时兜底给"人"(决策是人的活, 不该默认派给 agent)', () => {
    const db = db0();
    expect(suggestActorForRole(db, 'decider')).toBe('you');
  });

  it('routingTable 给全五个角色的默认人选', () => {
    const db = db0();
    const t = routingTable(db);
    expect(Object.keys(t).sort()).toEqual(['decider', 'executor', 'planner', 'questioner', 'tester']);
    expect(Object.values(t).every((v) => v !== null)).toBe(true);
  });
});
