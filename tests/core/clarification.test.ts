import { describe, it, expect } from 'vitest';
import { openDb } from '../../src/db/connection';
import { createActor } from '../../src/repo/actors';
import { createTask, getTask } from '../../src/repo/tasks';
import { edgesFrom, edgesTo } from '../../src/repo/edges';
import { listEvents } from '../../src/repo/events';
import { raiseClarification, answerClarification } from '../../src/core/clarification';

// 模型: 提问挂起是平行的 hold='decision' —— 阶段不动, 原地举手; 全部答复后原地继续。
describe('待确认闭环', () => {
  it('执行者卡住 → 触发待确认 → 父任务原地挂起(阶段不动)', () => {
    const db = openDb(':memory:');
    createActor(db, { id: 'exec', name: '执行·A', type: 'agent' });
    createActor(db, { id: 'admin', name: 'admin', type: 'human' });
    const parent = createTask(db, {
      title: '搭建数据层', state: 'executing', currentActor: 'exec', currentRole: 'executor',
    });

    const { clarTask } = raiseClarification(db, {
      parentId: parent.id, byActor: 'exec',
      question: '信息包是否允许附件?', options: ['纯 Markdown', '结构化 JSON'], toDecider: 'admin',
    });

    const p = getTask(db, parent.id)!;
    expect(p.hold).toBe('decision');   // 挂起 = 平行字段
    expect(p.state).toBe('executing'); // 阶段原地不动 —— 挂起不是搬站
    expect(clarTask.parentId).toBe(parent.id);
    expect(clarTask.hold).toBe('decision');
    expect(clarTask.currentRole).toBe('decider');
    expect(clarTask.goal).toContain('信息包是否允许附件?');
    expect(clarTask.goal).toContain('纯 Markdown'); // 选项进了 goal

    // 边: 子 --clarifies--> 父, 父 --spawns--> 子
    expect(edgesFrom(db, clarTask.id).some((e) => e.type === 'clarifies' && e.toTask === parent.id)).toBe(true);
    expect(edgesTo(db, clarTask.id).some((e) => e.type === 'spawns' && e.fromTask === parent.id)).toBe(true);
    const ev = listEvents(db, parent.id).at(-1)!;
    expect(ev.kind).toBe('clarify');
    expect(ev.holdTo).toBe('decision'); // 「经过」有挂起证据
  });

  it('决策者答复 → 答案回流 → 父任务解除挂起、原地继续', () => {
    const db = openDb(':memory:');
    createActor(db, { id: 'exec', name: '执行·A', type: 'agent' });
    createActor(db, { id: 'admin', name: 'admin', type: 'human' });
    const parent = createTask(db, {
      title: '搭建数据层', state: 'executing', currentActor: 'exec', currentRole: 'executor',
    });
    const { clarTask } = raiseClarification(db, {
      parentId: parent.id, byActor: 'exec', question: '附件?', toDecider: 'admin',
    });

    const { clarTask: closed, parent: resumed } = answerClarification(db, {
      clarTaskId: clarTask.id, byActor: 'admin', answer: '方案 A: 纯 Markdown + 外链',
    });

    expect(closed.state).toBe('done');
    expect(closed.hold).toBeNull();
    expect(closed.outputsMd).toBe('方案 A: 纯 Markdown + 外链');
    expect(resumed.hold).toBeNull();       // 解除挂起
    expect(resumed.state).toBe('executing'); // 在哪站挂起就回哪站
    expect(listEvents(db, parent.id).at(-1)!.kind).toBe('decide');
  });

  it('多个待确认: 答一个不解除, 全答完才解除', () => {
    const db = openDb(':memory:');
    createActor(db, { id: 'exec', name: '执行·A', type: 'agent' });
    createActor(db, { id: 'admin', name: 'admin', type: 'human' });
    const parent = createTask(db, { title: 'p', state: 'executing', currentActor: 'exec', currentRole: 'executor' });
    const { clarTask: c1 } = raiseClarification(db, { parentId: parent.id, byActor: 'exec', question: 'Q1', toDecider: 'admin' });
    const { clarTask: c2 } = raiseClarification(db, { parentId: parent.id, byActor: 'exec', question: 'Q2', toDecider: 'admin' });
    answerClarification(db, { clarTaskId: c1.id, byActor: 'admin', answer: 'A1' });
    expect(getTask(db, parent.id)!.hold).toBe('decision'); // 仍有 Q2
    answerClarification(db, { clarTaskId: c2.id, byActor: 'admin', answer: 'A2' });
    expect(getTask(db, parent.id)!.hold).toBeNull(); // 全答完, 解除
  });

  it('除完成外任何阶段都能提问中断, 且答复后回到原阶段(计划/测试同样能卡住问人)', () => {
    const db = openDb(':memory:');
    createActor(db, { id: 'p', name: 'P', type: 'agent' });
    createActor(db, { id: 'admin', name: 'admin', type: 'human' });
    for (const state of ['planning', 'testing'] as const) {
      const t = createTask(db, { title: `${state} 卡住`, state, currentActor: 'p', currentRole: 'planner' });
      const { clarTask } = raiseClarification(db, { parentId: t.id, byActor: 'p', question: '这样行吗?', toDecider: 'admin' });
      expect(getTask(db, t.id)!.hold).toBe('decision');
      expect(getTask(db, t.id)!.state).toBe(state);
      answerClarification(db, { clarTaskId: clarTask.id, byActor: 'admin', answer: '行' });
      expect(getTask(db, t.id)!.hold).toBeNull();
      expect(getTask(db, t.id)!.state).toBe(state); // 原地继续, 不假设"回执行中"
    }
    // 同一任务可中断多次(序列): 再问一轮照样成立
    const again = createTask(db, { title: '多次中断', state: 'executing', currentActor: 'p', currentRole: 'executor' });
    const r1 = raiseClarification(db, { parentId: again.id, byActor: 'p', question: '第一次?', toDecider: 'admin' });
    answerClarification(db, { clarTaskId: r1.clarTask.id, byActor: 'admin', answer: 'A' });
    const r2 = raiseClarification(db, { parentId: again.id, byActor: 'p', question: '第二次?', toDecider: 'admin' });
    expect(getTask(db, again.id)!.hold).toBe('decision');
    answerClarification(db, { clarTaskId: r2.clarTask.id, byActor: 'admin', answer: 'B' });
    expect(getTask(db, again.id)!.hold).toBeNull();
  });

  it('完成的任务不能提问; 挂在等确认上的任务先批准/打回才能提问', () => {
    const db = openDb(':memory:');
    createActor(db, { id: 'admin', name: 'admin', type: 'human' });
    const doneTask = createTask(db, { title: 'd', state: 'done' });
    expect(() => raiseClarification(db, { parentId: doneTask.id, byActor: 'admin', question: 'Q' })).toThrow(/已完成/);
    const confirming = createTask(db, { title: 'c', state: 'planning', hold: 'confirm', currentActor: 'admin', currentRole: 'decider' });
    expect(() => raiseClarification(db, { parentId: confirming.id, byActor: 'admin', question: 'Q' })).toThrow(/等确认/);
  });

  it('已决策的待确认不可重复答复', () => {
    const db = openDb(':memory:');
    createActor(db, { id: 'exec', name: 'A', type: 'agent' });
    createActor(db, { id: 'admin', name: 'admin', type: 'human' });
    const parent = createTask(db, { title: 'p', state: 'executing', currentActor: 'exec', currentRole: 'executor' });
    const { clarTask } = raiseClarification(db, { parentId: parent.id, byActor: 'exec', question: 'Q', toDecider: 'admin' });
    answerClarification(db, { clarTaskId: clarTask.id, byActor: 'admin', answer: 'A' });
    expect(() => answerClarification(db, { clarTaskId: clarTask.id, byActor: 'admin', answer: 'A2' })).toThrow(/勿重复/);
  });
});
