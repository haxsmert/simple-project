import { describe, it, expect } from 'vitest';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDb } from '../../src/db/connection';
import { RelayService } from '../../src/service/relay';

function svc() {
  const db = openDb(':memory:');
  const dir = mkdtempSync(join(tmpdir(), 'relay-mir-'));
  return { db, dir, service: new RelayService(db, dir) };
}

describe('mirror-affected set', () => {
  it('换手子任务后, 父任务的 .md 反映子任务新状态', () => {
    const { dir, service } = svc();
    service.registerActor({ id: 'x', name: 'X', type: 'agent' });
    service.registerActor({ id: 'y', name: 'Y', type: 'agent' });
    const parent = service.createTask({ title: '父', state: 'executing' });
    const child = service.createTask({ title: '子', parentId: parent.id, state: 'executing', currentActor: 'x', currentRole: 'executor' });
    // 换手子任务到 testing(暂不 done, testing 不是 done 复选框, 改成先到 done 验证复选框)
    service.handoff({ taskId: child.id, byActor: 'x', toActor: 'y', toRole: 'tester', toState: 'testing' });
    service.handoff({ taskId: child.id, byActor: 'y', toActor: 'y', toRole: 'tester', toState: 'done' });
    const parentMd = readFileSync(join(dir, `${parent.id}.md`), 'utf8');
    expect(parentMd).toContain(`[x] ${child.id}`); // 父 .md 里子任务已勾选=done, 非陈旧
  });

  it('改依赖任务摘要后, 依赖者的 .md 反映新摘要', () => {
    const { dir, service } = svc();
    service.registerActor({ id: 'x', name: 'X', type: 'agent' });
    const dep = service.createTask({ title: '被依赖', summary: '旧摘要' });
    const consumer = service.createTask({ title: '依赖者' });
    service.linkEdge({ fromTask: consumer.id, toTask: dep.id, type: 'depends_on' });
    service.submitOutput(dep.id, 'x', { summary: '新摘要' });
    const consumerMd = readFileSync(join(dir, `${consumer.id}.md`), 'utf8');
    expect(consumerMd).toContain('新摘要'); // 依赖者 .md 的"依赖产出"已刷新
  });
});
