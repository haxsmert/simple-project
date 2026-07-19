import { describe, it, expect } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDb } from '../../src/db/connection';
import { RelayService } from '../../src/service/relay';
import { buildApp } from '../../src/web/api';

function mk() {
  const db = openDb(':memory:');
  const service = new RelayService(db, mkdtempSync(join(tmpdir(), 'relay-web-')));
  return { service, app: buildApp(service) };
}

describe('web api', () => {
  it('POST /api/tasks 建任务, GET /api/tasks/:id 取信息包', async () => {
    const { app } = mk();
    const created = await app.inject({ method: 'POST', url: '/api/tasks', payload: { title: '新', goal: '目标' } });
    expect(created.statusCode).toBe(200);
    const id = created.json().id;
    const pkg = await app.inject({ method: 'GET', url: `/api/tasks/${id}` });
    expect(pkg.json().inputs.goal).toBe('目标');
  });

  it('待确认全链路: raise → answer', async () => {
    const { service, app } = mk();
    service.registerActor({ id: 'x', name: 'X', type: 'agent' });
    service.registerActor({ id: 'admin', name: 'admin', type: 'human' });
    const h = service.createTask({ title: '宿主项目', goal: 'g' });
    const p = service.createTask({ title: 'p', parentId: h.id, state: 'executing', currentActor: 'x', currentRole: 'executor' });
    const raised = await app.inject({ method: 'POST', url: '/api/clarifications', payload: { parentId: p.id, byActor: 'x', question: 'Q', toDecider: 'admin' } });
    const clarId = raised.json().clarTask.id;
    const ans = await app.inject({ method: 'POST', url: `/api/clarifications/${clarId}/answer`, payload: { byActor: 'admin', answer: 'A' } });
    expect(ans.statusCode).toBe(200);
    expect(ans.json().parent.state).toBe('executing');
  });

  it('GET /api/tasks 过滤发现面 + GET /api/pending/:actorId 待处理清单(IM 集成两大入口)', async () => {
    const { service, app } = mk();
    service.registerActor({ id: 'x', name: 'X', type: 'agent' });
    service.registerActor({ id: 'admin', name: 'admin', type: 'human' });
    const h = service.createTask({ title: '宿主项目', goal: 'g', currentActor: 'admin', currentRole: 'planner' });
    service.createTask({ title: '没人认领', parentId: h.id, state: 'planning' });
    const parent = service.createTask({ title: '执行中', parentId: h.id, state: 'executing', currentActor: 'x', currentRole: 'executor' });
    service.raiseClarification({ parentId: parent.id, byActor: 'x', question: '怎么选?', options: ['方案甲'], toDecider: 'admin' });

    const unassigned = await app.inject({ method: 'GET', url: '/api/tasks?unassigned=1' });
    expect(unassigned.json().map((t: any) => t.title)).toEqual(['没人认领']);
    const held = await app.inject({ method: 'GET', url: '/api/tasks?hold=any' });
    expect(held.json().length).toBe(2); // 挂起的父任务 + 问题卡

    const pending = await app.inject({ method: 'GET', url: '/api/pending/admin' });
    expect(pending.statusCode).toBe(200);
    const p = pending.json();
    expect(p.decisions).toHaveLength(1);
    expect(p.decisions[0].questionText).toBe('怎么选?');
    expect(p.decisions[0].options).toEqual([{ key: 'A', text: '方案甲' }]);
    expect(p.decisions[0].parent.title).toBe('执行中');
  });

  it('GET /api/projects 返回项目总览 { active, closed }: 卡带目标/attention/最近动静', async () => {
    const { service, app } = mk();
    service.registerActor({ id: 'x', name: 'X', type: 'agent' });
    const project = service.createTask({ title: '项目', goal: '长期方向' });
    service.createTask({ title: '子任务', parentId: project.id, state: 'done' });
    service.comment(project.id, 'x', '动一下');
    const closedP = service.createTask({ title: '收官项目', goal: 'g', state: 'done' });
    const res = await app.inject({ method: 'GET', url: '/api/projects' });
    expect(res.statusCode).toBe(200);
    const ov = res.json();
    expect(ov.active.map((t: any) => t.id)).toEqual([project.id]);
    expect(ov.closed.map((t: any) => t.id)).toEqual([closedP.id]);
    expect(ov.active[0].goal).toBe('长期方向');
    expect(ov.active[0].attention).toBe(0);
    expect(ov.active[0].lastEvent.kind).toBe('comment');
    expect(ov.active[0].lastEvent.actorName).toBe('X');
  });

  it('GET /api/projects/:id/board 返回该项目的直接子任务', async () => {
    const { service, app } = mk();
    const project = service.createTask({ title: '项目', goal: 'g' });
    const task = service.createTask({ title: '子任务', parentId: project.id, state: 'executing' });
    service.createTask({ title: '孙任务', parentId: task.id, state: 'planning' });
    const res = await app.inject({ method: 'GET', url: `/api/projects/${project.id}/board` });
    expect(res.statusCode).toBe(200);
    const board = res.json();
    expect(board).toHaveLength(4);
    const allIds = board.flatMap((c: any) => c.tasks.map((t: any) => t.id));
    expect(allIds).toEqual([task.id]);
  });

  it('GET /api/tasks-board 返回主干四阶段分组的全部项目一层任务', async () => {
    const { service, app } = mk();
    const projectA = service.createTask({ title: '项目A', goal: 'ga' });
    const taskA = service.createTask({ title: 'A-任务', parentId: projectA.id, state: 'executing' });
    service.createTask({ title: 'A-孙任务', parentId: taskA.id, state: 'planning' });
    const projectB = service.createTask({ title: '项目B', goal: 'gb' });
    const taskB = service.createTask({ title: 'B-任务', parentId: projectB.id, state: 'done' });

    const res = await app.inject({ method: 'GET', url: '/api/tasks-board' });
    expect(res.statusCode).toBe(200);
    const board = res.json();
    expect(board).toHaveLength(4);
    const allIds = board.flatMap((c: any) => c.tasks.map((t: any) => t.id));
    expect(allIds.sort()).toEqual([taskA.id, taskB.id].sort());
    expect(allIds).not.toContain(projectA.id);
    expect(allIds).not.toContain(projectB.id);
  });

  it('POST /api/reorder 重排列内顺序, 看板反映新顺序', async () => {
    const { service, app } = mk();
    const p = service.createTask({ title: '项目', goal: 'g' });
    const t1 = service.createTask({ title: 't1', parentId: p.id, state: 'executing' });
    const t2 = service.createTask({ title: 't2', parentId: p.id, state: 'executing' });
    const t3 = service.createTask({ title: 't3', parentId: p.id, state: 'executing' });

    const res = await app.inject({
      method: 'POST',
      url: '/api/reorder',
      payload: { ids: [t3.id, t1.id, t2.id] },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true });

    const board = await app.inject({ method: 'GET', url: `/api/projects/${p.id}/board` });
    const executing = board.json().find((c: any) => c.state === 'executing');
    expect(executing.tasks.map((t: any) => t.id)).toEqual([t3.id, t1.id, t2.id]);
  });

  it('非法操作 → 400 + error', async () => {
    const { app } = mk();
    const res = await app.inject({ method: 'GET', url: '/api/tasks/不存在' });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toMatch(/不存在/);
  });
});
