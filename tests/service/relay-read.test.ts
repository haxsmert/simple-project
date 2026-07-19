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
  it('tree 递归嵌套子任务', () => {
    const { db, service } = svc();
    createTask(db, { id: 'R-1', title: '根', state: 'executing' });
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

  it('看板把每个任务富化成 BoardCard: 子任务计数 + 关系边', () => {
    const { db, service } = svc();
    createTask(db, { id: 'R-9', title: '宿主项目', state: 'executing' });
    createTask(db, { id: 'R-10', title: '有子任务与依赖的任务', parentId: 'R-9', state: 'executing' });
    createTask(db, { id: 'R-11', title: '子任务1', parentId: 'R-10', state: 'done' });
    createTask(db, { id: 'R-12', title: '子任务2', parentId: 'R-10', state: 'executing' });
    createTask(db, { id: 'R-13', title: '被依赖任务', parentId: 'R-9', state: 'done' });
    service.linkEdge({ fromTask: 'R-10', toTask: 'R-13', type: 'depends_on' });

    const board = service.taskBoard('R-9');
    const card = board.find((c) => c.state === 'executing')!.tasks.find((t) => t.id === 'R-10')!;
    expect(card.subtaskCount).toBe(2);
    expect(card.doneSubtaskCount).toBe(1);
    expect(card.edges.out.map((e) => e.type)).toEqual(['depends_on']);
    expect(card.edges.out[0].toTask).toBe('R-13');
    expect(card.edges.in).toEqual([]);
  });

  // 项目总览 = 项目层透镜(2026-07-19 定调): 两态分组(执行中/已完结), 不按四阶段
  it('projectOverview: active/closed 两组; 执行中有活等你的冒头; closed 沉底; 卡带最近动静(含后代任务的事件)', () => {
    const { db, service } = svc();
    createActor(db, { id: 'x', name: '执行·X', type: 'agent' });
    createActor(db, { id: 'admin', name: 'admin', type: 'human' });
    // 项目A: 无挂起, 但子任务上有最近动静
    createTask(db, { id: 'R-20', title: '项目A', state: 'executing', goal: '方向A' });
    createTask(db, { id: 'R-21', title: '任务1', parentId: 'R-20', state: 'executing', currentActor: 'x', currentRole: 'executor' });
    // 项目B: 有一个等确认 → attention=1, 该排到 A 前面
    createTask(db, { id: 'R-30', title: '项目B', state: 'executing', goal: '方向B' });
    createTask(db, { id: 'R-31', title: '待拍板', parentId: 'R-30', state: 'planning', hold: 'confirm', currentActor: 'admin', currentRole: 'decider' });
    // 项目C: 已完结 → closed 组
    createTask(db, { id: 'R-40', title: '项目C', state: 'done', goal: '收官' });
    // 最近动静落在 A 的**孙层级**也要被捕捉(全树)
    service.comment('R-21', 'x', '推进了一步');

    const ov = service.projectOverview();
    expect(ov.active.map((c) => c.id)).toEqual(['R-30', 'R-20']); // B(有活等你) 冒头
    expect(ov.closed.map((c) => c.id)).toEqual(['R-40']);
    expect(ov.active.find((c) => c.id === 'R-30')!.attention).toBe(1);
    const a = ov.active.find((c) => c.id === 'R-20')!;
    expect(a.attention).toBe(0);
    expect(a.lastEvent!.kind).toBe('comment');
    expect(a.lastEvent!.actorName).toBe('执行·X');
    expect(a.lastEvent!.taskTitle).toBe('任务1'); // 动静发生在哪个任务, 卡面要说得出
    expect(ov.closed[0].lastEvent).toBeNull(); // C 没有任何事件 —— 不编
  });

  it('taskBoard(projectId) 只按状态分组该项目的直接子任务, 不含孙任务', () => {
    const { db, service } = svc();
    createTask(db, { id: 'R-30', title: '项目', state: 'executing' });
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

  it('allTasksBoard 聚合执行中项目的一层任务(depth 1); 已完结项目的遗留任务不进找活面', () => {
    const { db, service } = svc();
    createTask(db, { id: 'R-40', title: '项目A', state: 'executing' });
    createTask(db, { id: 'R-41', title: 'A-任务1', parentId: 'R-40', state: 'executing' });
    createTask(db, { id: 'R-42', title: 'A-任务2', parentId: 'R-40', state: 'done' });
    createTask(db, { id: 'R-43', title: 'A-孙任务', parentId: 'R-41', state: 'planning' });

    createTask(db, { id: 'R-50', title: '项目B', state: 'executing' });
    createTask(db, { id: 'R-51', title: 'B-任务1', parentId: 'R-50', state: 'planning' });
    createTask(db, { id: 'R-52', title: 'B-任务2', parentId: 'R-50', state: 'done' });

    // 已完结项目 C 带着遗留任务(完结允许遗留) —— 遗留不再是"要干的活"
    createTask(db, { id: 'R-60', title: '项目C(已完结)', state: 'done' });
    createTask(db, { id: 'R-61', title: 'C-遗留任务', parentId: 'R-60', state: 'executing' });

    const board = service.allTasksBoard();
    expect(board.map((c) => c.state)).toEqual(STATE_ORDER);
    const allIds = board.flatMap((c) => c.tasks.map((t) => t.id));
    expect(allIds.sort()).toEqual(['R-41', 'R-42', 'R-51', 'R-52']);
    expect(allIds).not.toContain('R-40');
    expect(allIds).not.toContain('R-50');
    expect(allIds).not.toContain('R-43');
    expect(allIds).not.toContain('R-61'); // 已完结项目的遗留任务被排除

    expect(board.find((c) => c.state === 'planning')!.tasks.map((t) => t.id)).toEqual(['R-51']);
    expect(board.find((c) => c.state === 'executing')!.tasks.map((t) => t.id)).toEqual(['R-41']);
    expect(board.find((c) => c.state === 'done')!.tasks.map((t) => t.id).sort()).toEqual(['R-42', 'R-52']);

    const card = board.find((c) => c.state === 'executing')!.tasks.find((t) => t.id === 'R-41')!;
    expect(card.subtaskCount).toBe(1);
    expect(card.doneSubtaskCount).toBe(0);
    expect(card.edges).toEqual({ out: [], in: [] });
  });

  it('taskBoard/allTasksBoard 的任务卡带 parentTitle(所属项目名); 项目卡 parentTitle 为 null', () => {
    const { db, service } = svc();
    createTask(db, { id: 'R-70', title: '项目蒸汽机', state: 'executing' });
    createTask(db, { id: 'R-71', title: '任务1', parentId: 'R-70', state: 'executing' });

    const taskCard = service.taskBoard('R-70').find((c) => c.state === 'executing')!.tasks.find((t) => t.id === 'R-71')!;
    expect(taskCard.parentTitle).toBe('项目蒸汽机');

    const allCard = service.allTasksBoard().find((c) => c.state === 'executing')!.tasks.find((t) => t.id === 'R-71')!;
    expect(allCard.parentTitle).toBe('项目蒸汽机');

    const projectCard = service.projectOverview().active.find((t) => t.id === 'R-70')!;
    expect(projectCard.parentId).toBeNull();
  });

  it('projectOverview 项目卡 attention = 直接任务里挂起(等确认+等决策)数, 与看板挂起卡数一致; taskBoard/allTasksBoard 不带', () => {
    const { db, service } = svc();
    service.registerActor({ id: 'x', name: 'X', type: 'agent' });
    service.registerActor({ id: 'admin', name: 'admin', type: 'human' });

    // 项目A: 任务1 执行中提问 → 原地挂 decision(阶段留在执行中); 任务2 计划挂 confirm 等拍板
    createTask(db, { id: 'R-80', title: '项目A', state: 'executing' });
    createTask(db, { id: 'R-81', title: '任务1', parentId: 'R-80', state: 'executing', currentActor: 'x', currentRole: 'executor' });
    service.raiseClarification({ parentId: 'R-81', byActor: 'x', question: '选哪个方案?', toDecider: 'admin' }); // 自动生成 clar 任务 R-82
    createTask(db, { id: 'R-85', title: '任务2(计划待确认)', parentId: 'R-80', state: 'planning', hold: 'confirm', currentActor: 'admin', currentRole: 'decider' });

    // 项目B: 全程无待你处理项
    createTask(db, { id: 'R-90', title: '项目B', state: 'executing' });
    createTask(db, { id: 'R-91', title: '任务1', parentId: 'R-90', state: 'executing' });

    const ov = service.projectOverview();
    const cardA = ov.active.find((t) => t.id === 'R-80')!;
    const cardB = ov.active.find((t) => t.id === 'R-90')!;
    expect(cardA.attention).toBe(2); // R-81(挂 decision) + R-85(挂 confirm); 更深的问题卡不重复计数
    expect(cardB.attention).toBe(0);
    expect(ov.active[0].id).toBe('R-80'); // 有活等你的排最前

    // 诚实/可对账: attention 必须等于该项目任务看板上亮挂起标的卡数(所见即所计)
    const boardA = service.taskBoard('R-80').flatMap((c) => c.tasks);
    expect(cardA.attention).toBe(boardA.filter((t) => t.hold !== null).length);
    // 挂起的任务留在自己的阶段列"原地举手", 不搬列
    const execCol = service.taskBoard('R-80').find((c) => c.state === 'executing')!;
    const taskCard = execCol.tasks.find((t) => t.id === 'R-81')!;
    expect(taskCard.hold).toBe('decision');
    expect(taskCard.attention).toBeUndefined();

    const allCard = service.allTasksBoard().find((c) => c.state === 'executing')!.tasks.find((t) => t.id === 'R-81')!;
    expect(allCard.attention).toBeUndefined();
  });

  it('listTasks 发现面: 按 未认领/阶段/挂起 过滤 —— agent 找活不能只看"已分给我的"', () => {
    const { db, service } = svc();
    service.registerActor({ id: 'x', name: 'X', type: 'agent' });
    createTask(db, { id: 'R-49', title: '宿主项目', state: 'executing', currentActor: 'x', currentRole: 'planner' });
    createTask(db, { id: 'R-50', title: '没人认领', parentId: 'R-49', state: 'planning' });
    createTask(db, { id: 'R-51', title: '在做', parentId: 'R-49', state: 'executing', currentActor: 'x', currentRole: 'executor' });
    createTask(db, { id: 'R-52', title: '等确认', parentId: 'R-49', state: 'planning', hold: 'confirm', currentActor: 'x', currentRole: 'decider' });
    expect(service.listTasks({ unassigned: true }).map((t) => t.id)).toEqual(['R-50']);
    expect(service.listTasks({ state: 'executing' }).map((t) => t.id)).toEqual(['R-49', 'R-51']);
    expect(service.listTasks({ hold: 'any' }).map((t) => t.id)).toEqual(['R-52']);
    expect(service.listTasks({ hold: 'none', state: 'planning' }).map((t) => t.id)).toEqual(['R-50']);
    expect(service.listTasks().length).toBe(4);
  });

  it('pendingFor 是 IM 推送的数据源: 等拍板附计划全文, 等答复附问题/结构化选项/所属任务; 被挂起的父任务不混进来', () => {
    const { db, service } = svc();
    service.registerActor({ id: 'x', name: 'X', type: 'agent' });
    service.registerActor({ id: 'admin', name: 'admin', type: 'human' });
    createTask(db, { id: 'R-59', title: '宿主项目', state: 'executing' });
    // 等拍板: 计划站挂 confirm, 交到 admin 手里
    createTask(db, { id: 'R-60', title: '注册流程', parentId: 'R-59', state: 'planning', hold: 'confirm', currentActor: 'admin', currentRole: 'decider', planMd: '- [ ] 第一步' });
    // 等答复: x 在 R-61 上提问给 admin → 生成问题卡(admin 持有), 父任务挂起(x 仍持有)
    createTask(db, { id: 'R-61', title: '导出报告', parentId: 'R-59', state: 'executing', currentActor: 'x', currentRole: 'executor' });
    service.raiseClarification({ parentId: 'R-61', byActor: 'x', question: '含已完成的吗?', options: ['含全部', '仅未完成'], toDecider: 'admin' });

    const p = service.pendingFor('admin');
    expect(p.confirms.map((c) => c.task.id)).toEqual(['R-60']);
    expect(p.confirms[0].plan).toBe('- [ ] 第一步'); // 拍板依据直接带上, 机器人不用再取一次
    expect(p.decisions).toHaveLength(1);
    expect(p.decisions[0].questionText).toBe('含已完成的吗?');
    expect(p.decisions[0].options).toEqual([{ key: 'A', text: '含全部' }, { key: 'B', text: '仅未完成' }]); // IM 卡片可直接出按钮
    expect(p.decisions[0].parent?.id).toBe('R-61'); // 上下文: 问题属于哪个任务
    // 被挂起的父任务 R-61 持有人是 x, 不在 admin 清单里; x 的清单里它也不算"待处理"(它在等别人)
    const px = service.pendingFor('x');
    expect(px.confirms).toHaveLength(0);
    expect(px.decisions).toHaveLength(0); // R-61 挂着但不是问题卡 → 不进决策清单
  });

  it('列是队列, 位置即优先级: 未手动排序(rank null)时按 priority 落位(hi>mid>lo>无), 手动排过的服从人的排列', () => {
    const { db, service } = svc();
    createTask(db, { id: 'R-100', title: '父', state: 'executing' });
    createTask(db, { id: 'R-101', title: '低', parentId: 'R-100', state: 'executing', priority: 'lo' });
    createTask(db, { id: 'R-102', title: '高', parentId: 'R-100', state: 'executing', priority: 'hi' });
    createTask(db, { id: 'R-103', title: '中', parentId: 'R-100', state: 'executing', priority: 'mid' });
    const col = service.taskBoard('R-100').find((c) => c.state === 'executing')!;
    expect(col.tasks.map((t) => t.id)).toEqual(['R-102', 'R-103', 'R-101']); // 默认顺序就讲得通: 越靠前越优先
    // 人拖过之后 rank 说了算(拖拽调序 = 调优先级)
    service.reorder(['R-101', 'R-102', 'R-103']);
    const after = service.taskBoard('R-100').find((c) => c.state === 'executing')!;
    expect(after.tasks.map((t) => t.id)).toEqual(['R-101', 'R-102', 'R-103']);
  });

  it('reorder 前列内按 id 排序(rank 为 null), reorder 后按给定顺序并回填 rank', () => {
    const { db, service } = svc();
    createTask(db, { id: 'R-60', title: '父', state: 'executing' });
    createTask(db, { id: 'R-61', title: '同胞1', parentId: 'R-60', state: 'executing' });
    createTask(db, { id: 'R-62', title: '同胞2', parentId: 'R-60', state: 'executing' });
    createTask(db, { id: 'R-63', title: '同胞3', parentId: 'R-60', state: 'executing' });

    const before = service.taskBoard('R-60').find((c) => c.state === 'executing')!.tasks;
    expect(before.map((t) => t.id)).toEqual(['R-61', 'R-62', 'R-63']);
    expect(before.every((t) => t.rank === null)).toBe(true);

    service.reorder(['R-63', 'R-61', 'R-62']);

    const after = service.taskBoard('R-60').find((c) => c.state === 'executing')!.tasks;
    expect(after.map((t) => t.id)).toEqual(['R-63', 'R-61', 'R-62']);
    expect(after.map((t) => t.rank)).toEqual([0, 1, 2]);
  });
});
