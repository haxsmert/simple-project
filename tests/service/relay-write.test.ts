import { describe, it, expect } from 'vitest';
import { mkdtempSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDb } from '../../src/db/connection';
import { getTask } from '../../src/repo/tasks';
import { listEvents } from '../../src/repo/events';
import { RelayService } from '../../src/service/relay';

function svc() {
  const db = openDb(':memory:');
  const dir = mkdtempSync(join(tmpdir(), 'relay-w-'));
  return { db, dir, service: new RelayService(db, dir) };
}

describe('RelayService writes (part A)', () => {
  it('createTask 建任务并镜像文件', () => {
    const { dir, service } = svc();
    const t = service.createTask({ title: '新任务' });
    expect(t.id).toBe('R-1');
    expect(existsSync(join(dir, 'R-1.md'))).toBe(true);
  });

  it('claim 设负责人+角色并留 claim 事件', () => {
    const { db, service } = svc();
    service.registerActor({ id: 'a', name: 'A', type: 'agent' });
    const t = service.createTask({ title: 't' });
    service.claim(t.id, 'a', 'executor');
    expect(getTask(db, t.id)!.currentActor).toBe('a');
    expect(getTask(db, t.id)!.currentRole).toBe('executor');
    expect(listEvents(db, t.id).at(-1)!.kind).toBe('claim');
  });

  it('submitPlan 写计划到 inputsMd 并留 plan 事件("提交计划"要有真通道, 不能是句空话)', () => {
    const { db, service } = svc();
    service.registerActor({ id: 'p', name: 'P', type: 'agent' });
    const t = service.createTask({ title: 't', inputsMd: '旧计划' });
    service.submitPlan(t.id, 'p', '- [ ] 第一步\n- [ ] 第二步');
    expect(getTask(db, t.id)!.inputsMd).toBe('- [ ] 第一步\n- [ ] 第二步');
    const ev = listEvents(db, t.id).at(-1)!;
    expect(ev.kind).toBe('plan');
    expect(ev.actorId).toBe('p');
  });

  it('submitOutput 只更新给定字段并留 output 事件', () => {
    const { db, service } = svc();
    service.registerActor({ id: 'a', name: 'A', type: 'agent' });
    const t = service.createTask({ title: 't', outputsMd: '旧' });
    service.submitOutput(t.id, 'a', { summary: '干完了' });
    expect(getTask(db, t.id)!.summary).toBe('干完了');
    expect(getTask(db, t.id)!.outputsMd).toBe('旧'); // 未提供的字段不动
    expect(listEvents(db, t.id).at(-1)!.kind).toBe('output');
  });

  it('comment 追加评论事件', () => {
    const { db, service } = svc();
    service.registerActor({ id: 'a', name: 'A', type: 'agent' });
    const t = service.createTask({ title: 't' });
    const ev = service.comment(t.id, 'a', '看一下这里');
    expect(ev.kind).toBe('comment');
    expect(listEvents(db, t.id).at(-1)!.body).toBe('看一下这里');
  });
});
