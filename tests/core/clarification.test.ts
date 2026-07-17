import { describe, it, expect } from 'vitest';
import { openDb } from '../../src/db/connection';
import { createActor } from '../../src/repo/actors';
import { createTask, getTask } from '../../src/repo/tasks';
import { edgesFrom, edgesTo } from '../../src/repo/edges';
import { listEvents } from '../../src/repo/events';
import { raiseClarification, answerClarification } from '../../src/core/clarification';

describe('待确认闭环', () => {
  it('执行者卡住 → 触发待确认 → 父任务挂起', () => {
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

    expect(getTask(db, parent.id)!.state).toBe('awaiting_decision'); // 父挂起
    expect(clarTask.parentId).toBe(parent.id);
    expect(clarTask.state).toBe('awaiting_decision');
    expect(clarTask.currentRole).toBe('decider');
    expect(clarTask.goal).toContain('信息包是否允许附件?');
    expect(clarTask.goal).toContain('纯 Markdown'); // 选项进了 goal

    // 边: 子 --clarifies--> 父, 父 --spawns--> 子
    expect(edgesFrom(db, clarTask.id).some((e) => e.type === 'clarifies' && e.toTask === parent.id)).toBe(true);
    expect(edgesTo(db, clarTask.id).some((e) => e.type === 'spawns' && e.fromTask === parent.id)).toBe(true);
    expect(listEvents(db, parent.id).at(-1)!.kind).toBe('clarify');
  });

  it('决策者答复 → 答案回流 → 父任务解冻续跑', () => {
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
    expect(closed.outputsMd).toBe('方案 A: 纯 Markdown + 外链');
    expect(resumed.state).toBe('executing'); // 父解冻
    expect(listEvents(db, parent.id).at(-1)!.kind).toBe('decide');
  });

  it('多个待确认: 答一个不解冻, 全答完才解冻', () => {
    const db = openDb(':memory:');
    createActor(db, { id: 'exec', name: '执行·A', type: 'agent' });
    createActor(db, { id: 'admin', name: 'admin', type: 'human' });
    const parent = createTask(db, { title: 'p', state: 'executing', currentActor: 'exec', currentRole: 'executor' });
    const { clarTask: c1 } = raiseClarification(db, { parentId: parent.id, byActor: 'exec', question: 'Q1', toDecider: 'admin' });
    const { clarTask: c2 } = raiseClarification(db, { parentId: parent.id, byActor: 'exec', question: 'Q2', toDecider: 'admin' });
    answerClarification(db, { clarTaskId: c1.id, byActor: 'admin', answer: 'A1' });
    expect(getTask(db, parent.id)!.state).toBe('awaiting_decision'); // 仍有 Q2
    answerClarification(db, { clarTaskId: c2.id, byActor: 'admin', answer: 'A2' });
    expect(getTask(db, parent.id)!.state).toBe('executing'); // 全答完, 解冻
  });

  it('不能对非 executing 任务触发待确认(状态机权威)', () => {
    const db = openDb(':memory:');
    createActor(db, { id: 'admin', name: 'admin', type: 'human' });
    const p = createTask(db, { title: 'p', state: 'planning', currentActor: 'admin', currentRole: 'planner' });
    expect(() => raiseClarification(db, { parentId: p.id, byActor: 'admin', question: 'Q' })).toThrow(/非法状态流转/);
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
