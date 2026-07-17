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

  it('updateTaskInfo 改标题/目标/优先级并记「经过」; 无实际变更不记(别刷屏)', () => {
    const { db, service } = svc();
    service.registerActor({ id: 'a', name: 'A', type: 'agent' });
    const t = service.createTask({ title: '旧标题', goal: '旧目标' });
    service.updateTaskInfo(t.id, 'a', { title: '新标题', priority: 'hi' });
    const after = getTask(db, t.id)!;
    expect(after.title).toBe('新标题');
    expect(after.priority).toBe('hi');
    expect(after.goal).toBe('旧目标'); // 没给的字段不动
    const ev = listEvents(db, t.id).at(-1)!;
    expect(ev.kind).toBe('update');
    expect(ev.body).toContain('旧标题 → 新标题');
    const n = listEvents(db, t.id).length;
    service.updateTaskInfo(t.id, 'a', { title: '新标题' }); // 无变更
    expect(listEvents(db, t.id).length).toBe(n);
  });

  it('deleteTask: 叶子硬删并级联边/事件/镜像; 有子任务拒; 删未决问题卡=撤回提问并解冻父', () => {
    const { db, dir, service } = svc();
    service.registerActor({ id: 'x', name: 'X', type: 'agent' });
    service.registerActor({ id: 'admin', name: 'admin', type: 'human' });
    // 有子任务不许删
    const parent = service.createTask({ title: '父' });
    const leaf = service.createTask({ title: '子', parentId: parent.id });
    expect(() => service.deleteTask(parent.id, 'admin')).toThrow(/子任务/);
    // 叶子删除: 任务/事件/镜像文件都清掉
    service.comment(leaf.id, 'x', '留个言');
    expect(existsSync(join(dir, `${leaf.id}.md`))).toBe(true);
    service.deleteTask(leaf.id, 'admin');
    expect(getTask(db, leaf.id)).toBeNull();
    expect(db.prepare('SELECT COUNT(*) c FROM events WHERE task_id=?').get(leaf.id)).toEqual({ c: 0 });
    expect(existsSync(join(dir, `${leaf.id}.md`))).toBe(false);
    // 删未决问题卡 = 撤回提问 → 父解除挂起, 「经过」留痕
    const p2 = service.createTask({ title: '执行中', state: 'executing', currentActor: 'x', currentRole: 'executor' });
    const { clarTask } = service.raiseClarification({ parentId: p2.id, byActor: 'x', question: '问错了', toDecider: 'admin' });
    expect(getTask(db, p2.id)!.hold).toBe('decision');
    const r = service.deleteTask(clarTask.id, 'x');
    expect(r.unfrozeParent).toBe(p2.id);
    expect(getTask(db, p2.id)!.hold).toBeNull();
    expect(listEvents(db, p2.id).at(-1)!.body).toContain('撤回了提问');
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
