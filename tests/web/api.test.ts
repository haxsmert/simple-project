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
  it('GET /api/board 返回六态分组', async () => {
    const { service, app } = mk();
    service.createTask({ title: 't', state: 'executing' });
    const res = await app.inject({ method: 'GET', url: '/api/board' });
    expect(res.statusCode).toBe(200);
    const board = res.json();
    expect(board).toHaveLength(6);
    expect(board.find((c: any) => c.state === 'executing').tasks[0].title).toBe('t');
  });

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
    service.registerActor({ id: 'you', name: '你', type: 'human' });
    const p = service.createTask({ title: 'p', state: 'executing', currentActor: 'x', currentRole: 'executor' });
    const raised = await app.inject({ method: 'POST', url: '/api/clarifications', payload: { parentId: p.id, byActor: 'x', question: 'Q', toDecider: 'you' } });
    const clarId = raised.json().clarTask.id;
    const ans = await app.inject({ method: 'POST', url: `/api/clarifications/${clarId}/answer`, payload: { byActor: 'you', answer: 'A' } });
    expect(ans.statusCode).toBe(200);
    expect(ans.json().parent.state).toBe('executing');
  });

  it('GET /api/projects 返回六态分组的顶层任务', async () => {
    const { service, app } = mk();
    const project = service.createTask({ title: '项目', state: 'executing' });
    service.createTask({ title: '子任务', parentId: project.id, state: 'done' });
    const res = await app.inject({ method: 'GET', url: '/api/projects' });
    expect(res.statusCode).toBe(200);
    const board = res.json();
    expect(board).toHaveLength(6);
    const executing = board.find((c: any) => c.state === 'executing');
    expect(executing.tasks.map((t: any) => t.id)).toEqual([project.id]);
    const allIds = board.flatMap((c: any) => c.tasks.map((t: any) => t.id));
    expect(allIds).not.toContain(undefined);
  });

  it('GET /api/projects/:id/board 返回该项目的直接子任务', async () => {
    const { service, app } = mk();
    const project = service.createTask({ title: '项目', state: 'planning' });
    const task = service.createTask({ title: '子任务', parentId: project.id, state: 'executing' });
    service.createTask({ title: '孙任务', parentId: task.id, state: 'planning' });
    const res = await app.inject({ method: 'GET', url: `/api/projects/${project.id}/board` });
    expect(res.statusCode).toBe(200);
    const board = res.json();
    expect(board).toHaveLength(6);
    const allIds = board.flatMap((c: any) => c.tasks.map((t: any) => t.id));
    expect(allIds).toEqual([task.id]);
  });

  it('GET /api/tasks-board 返回六态分组的全部项目一层任务', async () => {
    const { service, app } = mk();
    const projectA = service.createTask({ title: '项目A', state: 'planning' });
    const taskA = service.createTask({ title: 'A-任务', parentId: projectA.id, state: 'executing' });
    service.createTask({ title: 'A-孙任务', parentId: taskA.id, state: 'planning' });
    const projectB = service.createTask({ title: '项目B', state: 'executing' });
    const taskB = service.createTask({ title: 'B-任务', parentId: projectB.id, state: 'done' });

    const res = await app.inject({ method: 'GET', url: '/api/tasks-board' });
    expect(res.statusCode).toBe(200);
    const board = res.json();
    expect(board).toHaveLength(6);
    const allIds = board.flatMap((c: any) => c.tasks.map((t: any) => t.id));
    expect(allIds.sort()).toEqual([taskA.id, taskB.id].sort());
    expect(allIds).not.toContain(projectA.id);
    expect(allIds).not.toContain(projectB.id);
  });

  it('非法操作 → 400 + error', async () => {
    const { app } = mk();
    const res = await app.inject({ method: 'GET', url: '/api/tasks/不存在' });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toMatch(/不存在/);
  });
});
