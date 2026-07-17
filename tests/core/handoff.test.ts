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

  // 实洞复盘(2026-07-17): 挂着等确认的任务被原地改派回规划者本人 → "在规划者手里却还等确认"的矛盾位
  it('原地改派不改变角色: 把等确认的任务转给 planner 角色被拒(矛盾位之源); 换决策者(同角色)放行', () => {
    const db = openDb(':memory:');
    createActor(db, { id: 'p', name: 'P', type: 'agent' });
    createActor(db, { id: 'admin', name: 'admin', type: 'human' });
    createActor(db, { id: 'admin2', name: 'admin2', type: 'human' });
    const t = createTask(db, { title: 't', state: 'planning', hold: 'confirm', currentActor: 'admin', currentRole: 'decider', planMd: '- [ ] x' });
    expect(() => handoff(db, { taskId: t.id, byActor: 'admin', toActor: 'p', toRole: 'planner' }))
      .toThrow(/原地改派不改变角色/);
    expect(handoff(db, { taskId: t.id, byActor: 'admin', toActor: 'admin2', toRole: 'decider' }).currentActor).toBe('admin2');
    // 未挂起的普通改派同样保角色
    const e = createTask(db, { title: 'e', state: 'executing', currentActor: 'p', currentRole: 'executor' });
    expect(() => handoff(db, { taskId: e.id, byActor: 'p', toActor: 'admin', toRole: 'tester' }))
      .toThrow(/原地改派不改变角色/);
  });

  it('自批闸在机制层: 提交确认不能交给自己; 确认挂起中改派也不能转回提交人(MCP 绕不过)', () => {
    const db = openDb(':memory:');
    createActor(db, { id: 'p', name: 'P', type: 'agent' });
    createActor(db, { id: 'admin', name: 'admin', type: 'human' });
    createActor(db, { id: 'admin2', name: 'admin2', type: 'human' });
    const t = createTask(db, { title: 't', state: 'planning', currentActor: 'p', currentRole: 'planner', planMd: '- [ ] x' });
    // 提交给自己批 → 拒
    expect(() => handoff(db, { taskId: t.id, byActor: 'p', toActor: 'p', toRole: 'decider', toHold: 'confirm' }))
      .toThrow(/不能当自己/);
    // 正常提交给 admin
    handoff(db, { taskId: t.id, byActor: 'p', toActor: 'admin', toRole: 'decider', toHold: 'confirm' });
    // 挂起中把确认改派回提交人 p → 拒(即使角色给对 decider)
    expect(() => handoff(db, { taskId: t.id, byActor: 'admin', toActor: 'p', toRole: 'decider' }))
      .toThrow(/不能当自己/);
    // 转给另一个决策者 → 放行
    expect(handoff(db, { taskId: t.id, byActor: 'admin', toActor: 'admin2', toRole: 'decider' }).currentActor).toBe('admin2');
  });

  // 对抗审计 P0(2026-07-18): 自批闸此前只守提交/改派方向, **批准方向整段失效**
  it('自批闸守住批准方向: 提交人不能自己批准通过; 决策者批准/打回正常; agent 不能冒名驱动别人的任务', () => {
    const db = openDb(':memory:');
    createActor(db, { id: 'p', name: 'P', type: 'agent' });
    createActor(db, { id: 'e', name: 'E', type: 'agent' });
    createActor(db, { id: 'admin', name: 'admin', type: 'human' });
    const t = createTask(db, { title: 't', state: 'planning', currentActor: 'p', currentRole: 'planner', planMd: '- [ ] x' });
    handoff(db, { taskId: t.id, byActor: 'p', toActor: 'admin', toRole: 'decider', toHold: 'confirm' });
    // 提交人 p 以 byActor 身份"批准"自己的计划 → 归属闸先拦(任务已在 admin 手里)
    expect(() => handoff(db, { taskId: t.id, byActor: 'p', toActor: 'p', toRole: 'executor', toState: 'executing', toHold: null }))
      .toThrow(/agent 只能转交\/推进自己持有的任务/);
    // 无关 agent 冒名驱动 → 拦
    expect(() => handoff(db, { taskId: t.id, byActor: 'e', toActor: 'e', toRole: 'executor', toState: 'executing', toHold: null }))
      .toThrow(/agent 只能转交\/推进自己持有的任务/);
    // 决策者批准 → 过(人类总管也能代操作任何任务)
    expect(handoff(db, { taskId: t.id, byActor: 'admin', toActor: 'p', toRole: 'executor', toState: 'executing', toHold: null }).state)
      .toBe('executing');
    // 假想"提交人恰好也持有"(挂起中改派给了别的 human 决策者后…)的纯自批场景: 批准方向闸兜底
    const t2 = createTask(db, { title: 't2', state: 'planning', currentActor: 'e', currentRole: 'planner', planMd: '- [ ] y' });
    createActor(db, { id: 'admin2', name: 'admin2', type: 'human' });
    handoff(db, { taskId: t2.id, byActor: 'e', toActor: 'admin', toRole: 'decider', toHold: 'confirm' });
    handoff(db, { taskId: t2.id, byActor: 'admin', toActor: 'admin2', toRole: 'decider' }); // 换决策者
    // admin2 打回 → 过(打回不受自批闸限制)
    expect(handoff(db, { taskId: t2.id, byActor: 'admin2', toActor: 'e', toRole: 'planner', toState: 'planning', toHold: null }).hold)
      .toBeNull();
  });

  it('终态与建子守卫(对抗审计 P1/P2): done 父不得添开放子; done 任务拒收计划/产出改写; 全等空转幂等不堆事件', () => {
    const db = openDb(':memory:');
    createActor(db, { id: 'admin', name: 'admin', type: 'human' });
    createActor(db, { id: 'x', name: 'X', type: 'agent' });
    const t = createTask(db, { title: '在做', state: 'executing', currentActor: 'x', currentRole: 'executor' });
    // 全等空转: human 重复同一改派, 第二次不追加事件
    createActor(db, { id: 'y', name: 'Y', type: 'agent' });
    handoff(db, { taskId: t.id, byActor: 'admin', toActor: 'y', toRole: 'executor' });
    const n = listEvents(db, t.id).length;
    handoff(db, { taskId: t.id, byActor: 'admin', toActor: 'y', toRole: 'executor' }); // 重试
    expect(listEvents(db, t.id).length).toBe(n); // 幂等, 「经过」不堆空转
  });
  it('有未完成子任务不得标记完成(硬闸); 子全完成后放行; 进测试不拦', () => {
    const db = openDb(':memory:');
    createActor(db, { id: 't', name: 'T', type: 'agent' });
    const parent = createTask(db, { title: '父', state: 'testing', currentActor: 't', currentRole: 'tester' });
    const child = createTask(db, { title: '子', parentId: parent.id, state: 'executing', currentActor: 't', currentRole: 'executor' });
    expect(() => handoff(db, { taskId: parent.id, byActor: 't', toActor: 't', toRole: 'tester', toState: 'done' }))
      .toThrow(/子任务全部完成才能标记完成/);
    // 进测试不拦: 父在执行中、子未完, 交测试是合法的(界面如实提示即可)
    const p2 = createTask(db, { title: '父2', state: 'executing', currentActor: 't', currentRole: 'executor' });
    createTask(db, { title: '子2', parentId: p2.id, state: 'executing' });
    expect(() => handoff(db, { taskId: p2.id, byActor: 't', toActor: 't', toRole: 'tester', toState: 'testing' })).not.toThrow();
    // 子全完成 → 放行
    handoff(db, { taskId: child.id, byActor: 't', toActor: 't', toRole: 'tester', toState: 'testing' });
    handoff(db, { taskId: child.id, byActor: 't', toActor: 't', toRole: 'tester', toState: 'done' });
    expect(handoff(db, { taskId: parent.id, byActor: 't', toActor: 't', toRole: 'tester', toState: 'done' }).state).toBe('done');
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
    const blank = createTask(db, { title: '空白计划', state: 'planning', currentActor: 'p', currentRole: 'planner', planMd: '  \n ' });
    expect(() => handoff(db, { taskId: blank.id, byActor: 'p', toActor: 'p', toRole: 'executor', toState: 'executing' }))
      .toThrow(/还没有计划/);
    const planned = createTask(db, { title: '有计划', state: 'planning', currentActor: 'p', currentRole: 'planner', planMd: '- [ ] 第一步' });
    expect(handoff(db, { taskId: planned.id, byActor: 'p', toActor: 'p', toRole: 'executor', toState: 'executing' }).state)
      .toBe('executing');
  });
});
