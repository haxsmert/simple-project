import { describe, it, expect } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDb } from '../../src/db/connection';
import { getTask } from '../../src/repo/tasks';
import { RelayService } from '../../src/service/relay';

function svc() {
  const db = openDb(':memory:');
  const dir = mkdtempSync(join(tmpdir(), 'relay-f-'));
  return { db, service: new RelayService(db, dir) };
}

describe('RelayService flow', () => {
  it('handoff 经 core 换手(状态机校验生效)', () => {
    const { db, service } = svc();
    service.registerActor({ id: 'x', name: 'X', type: 'agent' });
    service.registerActor({ id: 'y', name: 'Y', type: 'agent' });
    const t = service.createTask({ title: 't', state: 'executing', currentActor: 'x', currentRole: 'executor' });
    const after = service.handoff({ taskId: t.id, byActor: 'x', toActor: 'y', toRole: 'tester', toState: 'testing' });
    expect(after.currentRole).toBe('tester');
    expect(after.state).toBe('testing');
  });

  it('raise/answer 待确认全链路', () => {
    const { db, service } = svc();
    service.registerActor({ id: 'x', name: 'X', type: 'agent' });
    service.registerActor({ id: 'admin', name: 'admin', type: 'human' });
    const p = service.createTask({ title: 'p', state: 'executing', currentActor: 'x', currentRole: 'executor' });
    const { clarTask } = service.raiseClarification({ parentId: p.id, byActor: 'x', question: '附件?', toDecider: 'admin' });
    expect(getTask(db, p.id)!.state).toBe('awaiting_decision');
    service.answerClarification({ clarTaskId: clarTask.id, byActor: 'admin', answer: '方案A' });
    expect(getTask(db, p.id)!.state).toBe('executing');
  });

  it('linkEdge 建关系边', () => {
    const { service } = svc();
    const a = service.createTask({ title: 'a' });
    const b = service.createTask({ title: 'b' });
    const e = service.linkEdge({ fromTask: a.id, toTask: b.id, type: 'depends_on' });
    expect(e.type).toBe('depends_on');
  });
});
