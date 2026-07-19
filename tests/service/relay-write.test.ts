import { describe, it, expect } from 'vitest';
import { mkdtempSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDb } from '../../src/db/connection';
import { getTask, createTask } from '../../src/repo/tasks';
import { listEvents } from '../../src/repo/events';
import { RelayService } from '../../src/service/relay';

function svc() {
  const db = openDb(':memory:');
  const dir = mkdtempSync(join(tmpdir(), 'relay-w-'));
  return { db, dir, service: new RelayService(db, dir) };
}
// 项目=大号任务后顶层走项目规则(目标必填/两态) —— 任务机制的 fixture 挂在宿主项目下
const host = (service: RelayService): string => service.createTask({ title: '宿主项目', goal: '装任务用' }).id;

describe('RelayService writes (part A)', () => {
  it('createTask 建项目(目标必填)并镜像文件; 建子任务默认在计划阶段', () => {
    const { dir, service } = svc();
    const p = service.createTask({ title: '新项目', goal: '一个长期方向' });
    expect(p.id).toBe('R-1');
    expect(p.state).toBe('executing'); // 项目开了就在跑, 没有"待规划"
    expect(existsSync(join(dir, 'R-1.md'))).toBe(true);
    const t = service.createTask({ title: '新任务', parentId: p.id });
    expect(t.state).toBe('planning'); // 任务层默认从计划开始
  });

  it('claim 拒绝挂起中的任务(等确认/等决策不是"可领取的活", 自助领取会把锁连人抢走)', () => {
    const { db, service } = svc();
    service.registerActor({ id: 'a', name: 'A', type: 'agent' });
    const h = host(service);
    // 挂起位用 repo 层直造(service.createTask 已禁直造挂起 —— 挂起要走流程)
    const held = createTask(db, { id: 'R-70', title: '等确认', parentId: h, state: 'planning', hold: 'confirm', currentRole: 'decider' });
    expect(() => service.claim(held.id, 'a', 'executor')).toThrow(/挂起中.*不可领取/);
    // 对外通道直造挂起本身也被拦(对抗审计: 直造 confirm 探测不到提交人, 自批闸失明)
    expect(() => service.createTask({ title: 'x', parentId: h, hold: 'confirm' })).toThrow(/不能直接建出挂起/);
  });

  it('claim 设负责人+角色并留 claim 事件', () => {
    const { db, service } = svc();
    service.registerActor({ id: 'a', name: 'A', type: 'agent' });
    const t = service.createTask({ title: 't', parentId: host(service) });
    service.claim(t.id, 'a', 'executor');
    expect(getTask(db, t.id)!.currentActor).toBe('a');
    expect(getTask(db, t.id)!.currentRole).toBe('executor');
    expect(listEvents(db, t.id).at(-1)!.kind).toBe('claim');
  });

  it('submitPlan 写计划到 planMd 并留 plan 事件("提交计划"要有真通道, 不能是句空话)', () => {
    const { db, service } = svc();
    service.registerActor({ id: 'p', name: 'P', type: 'agent' });
    const t = service.createTask({ title: 't', parentId: host(service), planMd: '旧计划' });
    service.submitPlan(t.id, 'p', '- [ ] 第一步\n- [ ] 第二步');
    expect(getTask(db, t.id)!.planMd).toBe('- [ ] 第一步\n- [ ] 第二步');
    const ev = listEvents(db, t.id).at(-1)!;
    expect(ev.kind).toBe('plan');
    expect(ev.actorId).toBe('p');
  });

  it('submitOutput 只更新给定字段并留 output 事件', () => {
    const { db, service } = svc();
    service.registerActor({ id: 'a', name: 'A', type: 'agent' });
    const t = service.createTask({ title: 't', parentId: host(service), outputsMd: '旧' });
    service.submitOutput(t.id, 'a', { summary: '干完了' });
    expect(getTask(db, t.id)!.summary).toBe('干完了');
    expect(getTask(db, t.id)!.outputsMd).toBe('旧'); // 未提供的字段不动
    expect(listEvents(db, t.id).at(-1)!.kind).toBe('output');
  });

  it('updateTaskInfo 改标题/目标/优先级并记「经过」; 无实际变更不记(别刷屏)', () => {
    const { db, service } = svc();
    service.registerActor({ id: 'a', name: 'A', type: 'agent' });
    const t = service.createTask({ title: '旧标题', parentId: host(service), goal: '旧目标' });
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
    const h = host(service);
    // 有子任务不许删
    const parent = service.createTask({ title: '父', parentId: h });
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
    const p2 = service.createTask({ title: '执行中', parentId: h, state: 'executing', currentActor: 'x', currentRole: 'executor' });
    const { clarTask } = service.raiseClarification({ parentId: p2.id, byActor: 'x', question: '问错了', toDecider: 'admin' });
    expect(getTask(db, p2.id)!.hold).toBe('decision');
    const r = service.deleteTask(clarTask.id, 'x');
    expect(r.unfrozeParent).toBe(p2.id);
    expect(getTask(db, p2.id)!.hold).toBeNull();
    expect(listEvents(db, p2.id).at(-1)!.body).toContain('撤回了提问');
  });

  it('坏输入说人话(对抗演练沉淀): 空标题拒 / 项目无目标拒 / 不存在的行动者与父任务拒且不吐 FK 黑话', () => {
    const { service } = svc();
    service.registerActor({ id: 'a', name: 'A', type: 'agent' });
    expect(() => service.createTask({ title: '   ' })).toThrow(/标题不能为空/);
    // 项目 = 长期方向, 必须写清目标/说明 —— 光秃名字拒(2026-07-19 定调: "怎么能到了项目就变成一个名字和壳")
    expect(() => service.createTask({ title: '只有名字' })).toThrow(/项目.*必须写清目标/);
    expect(() => service.createTask({ title: 'x', goal: 'g', state: 'planning' })).toThrow(/两态/);
    expect(() => service.createTask({ title: 'x', parentId: 'R-999' })).toThrow(/任务不存在/);
    expect(() => service.createTask({ title: 'x', goal: 'g', currentActor: 'ghost' })).toThrow(/行动者不存在/);
    const t = service.createTask({ title: 't', goal: '方向' });
    expect(() => service.claim(t.id, 'ghost')).toThrow(/行动者不存在/);
    expect(() => service.comment(t.id, 'ghost', 'hi')).toThrow(/行动者不存在/);
    expect(() => service.handoff({ taskId: t.id, byActor: 'a', toActor: 'ghost', toRole: 'planner' })).toThrow(/行动者不存在/);
    expect(() => service.updateTaskInfo(t.id, 'a', { title: ' ' })).toThrow(/标题不能为空/);
  });

  it('终态守卫(对抗审计): 已完结项目下建开放任务拒(提示重开); done 任务的计划/产出改写拒', () => {
    const { service } = svc();
    service.registerActor({ id: 'a', name: 'A', type: 'agent' });
    const doneProj = service.createTask({ title: '已完结方向', goal: '收官了', state: 'done' });
    expect(() => service.createTask({ title: '完结后长出来', parentId: doneProj.id })).toThrow(/已完结.*重开/);
    expect(() => service.submitPlan(doneProj.id, 'a', '- [ ] 偷改')).toThrow(/已完成/);
    expect(() => service.submitOutput(doneProj.id, 'a', { outputsMd: '偷改' })).toThrow(/已完成/);
    // 建"已完成的子"归档场景仍允许(state:'done' 的子不破不变量)
    expect(service.createTask({ title: '补录完成件', parentId: doneProj.id, state: 'done' }).state).toBe('done');
    // 任务层的 done 父同样拦(措辞不同: 任务没有"重开")
    const h = service.createTask({ title: '活项目', goal: 'g' });
    const doneTask = service.createTask({ title: '完成的任务', parentId: h.id, state: 'done' });
    expect(() => service.createTask({ title: 'x', parentId: doneTask.id })).toThrow(/已完成.*不能再/);
  });

  it('linkEdge: 自环拒; 重复建边幂等返回已有(agent 重试不堆重复边)', () => {
    const { service } = svc();
    const a = service.createTask({ title: 'A', goal: 'ga' });
    const b = service.createTask({ title: 'B', goal: 'gb' });
    expect(() => service.linkEdge({ fromTask: a.id, toTask: a.id, type: 'depends_on' })).toThrow(/不能和自己/);
    const e1 = service.linkEdge({ fromTask: a.id, toTask: b.id, type: 'depends_on' });
    const e2 = service.linkEdge({ fromTask: a.id, toTask: b.id, type: 'depends_on' });
    expect(e2.id).toBe(e1.id); // 同一条, 不重复
  });

  it('registerActor 幂等: agent 每次启动自报家门不炸 UNIQUE, 改名生效', () => {
    const { service } = svc();
    service.registerActor({ id: 'cc', name: '旧名', type: 'agent' });
    const again = service.registerActor({ id: 'cc', name: '新名', type: 'agent' });
    expect(again.name).toBe('新名');
    expect(service.listActors().filter((x) => x.id === 'cc').length).toBe(1);
  });

  it('comment 追加评论事件', () => {
    const { db, service } = svc();
    service.registerActor({ id: 'a', name: 'A', type: 'agent' });
    const t = service.createTask({ title: 't', parentId: host(service) });
    const ev = service.comment(t.id, 'a', '看一下这里');
    expect(ev.kind).toBe('comment');
    expect(listEvents(db, t.id).at(-1)!.body).toBe('看一下这里');
  });

  it('对项目提问被拒(项目不挂起 —— 提问挂起是任务层节奏)', () => {
    const { service } = svc();
    service.registerActor({ id: 'x', name: 'X', type: 'agent' });
    service.registerActor({ id: 'admin', name: 'admin', type: 'human' });
    const p = service.createTask({ title: '长期方向', goal: 'g' });
    expect(() => service.raiseClarification({ parentId: p.id, byActor: 'x', question: '方向对吗?', toDecider: 'admin' }))
      .toThrow(/项目不挂起/);
  });
});
