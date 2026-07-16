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

  it('非法操作 → 400 + error', async () => {
    const { app } = mk();
    const res = await app.inject({ method: 'GET', url: '/api/tasks/不存在' });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toMatch(/不存在/);
  });
});
