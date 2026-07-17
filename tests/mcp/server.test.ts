import { describe, it, expect } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { openDb } from '../../src/db/connection';
import { RelayService } from '../../src/service/relay';
import { buildServer } from '../../src/mcp/server';
import { getTask } from '../../src/repo/tasks';

describe('MCP server (in-memory roundtrip)', () => {
  it('客户端能列出并调用工具', async () => {
    const db = openDb(':memory:');
    const service = new RelayService(db, mkdtempSync(join(tmpdir(), 'relay-srv-')));
    service.registerActor({ id: 'a', name: 'A', type: 'agent' });
    service.createTask({ title: 'demo', currentActor: 'a', currentRole: 'executor' });

    const server = buildServer(service);
    const [clientT, serverT] = InMemoryTransport.createLinkedPair();
    await server.connect(serverT);

    const client = new Client({ name: 'test', version: '0' });
    await client.connect(clientT);

    const tools = await client.listTools();
    expect(tools.tools.map((t) => t.name)).toContain('list_my_tasks');

    const res: any = await client.callTool({ name: 'list_my_tasks', arguments: { actor: 'a' } });
    const data = JSON.parse(res.content[0].text);
    expect(data.map((t: any) => t.title)).toContain('demo');

    await client.close();
    await server.close();
  });

  // agent 视角的完整生命周期在 MCP 协议线上真实往返(不是只测 handler 函数):
  // 注册→建任务→找活→领取→写计划→提交确认→admin 清单→批准→提问→答复→交产出→交测→完成→改信息→删问题外的收尾
  it('全生命周期 17 工具线上往返', async () => {
    const db = openDb(':memory:');
    const service = new RelayService(db, mkdtempSync(join(tmpdir(), 'relay-e2e-')));
    const server = buildServer(service);
    const [clientT, serverT] = InMemoryTransport.createLinkedPair();
    await server.connect(serverT);
    const client = new Client({ name: 'cc', version: '0' });
    await client.connect(clientT);
    const call = async (name: string, args: Record<string, unknown>) => {
      const res: any = await client.callTool({ name, arguments: args });
      if (res.isError) throw new Error(`${name}: ${res.content[0].text}`);
      return JSON.parse(res.content[0].text);
    };

    await call('register_actor', { id: 'admin', name: 'admin', type: 'human' });
    await call('register_actor', { id: 'cc', name: 'CC', type: 'agent' });
    expect((await call('list_actors', {})).length).toBe(2);
    const t = await call('create_task', { title: '演练任务', goal: '走一遍' });
    expect((await call('list_tasks', { unassigned: true })).map((x: any) => x.id)).toContain(t.id);
    await call('claim', { task_id: t.id, actor: 'cc', role: 'planner' });
    await call('submit_plan', { task_id: t.id, by_actor: 'cc', plan_md: '- [ ] 一步' });
    await call('handoff', { task_id: t.id, by_actor: 'cc', to_actor: 'admin', to_role: 'decider', to_hold: 'confirm' });
    const pending = await call('list_pending', { actor: 'admin' });
    expect(pending.confirms).toHaveLength(1);
    await call('handoff', { task_id: t.id, by_actor: 'admin', to_actor: 'cc', to_role: 'executor', to_state: 'executing', to_hold: 'none' });
    const raised = await call('raise_clarification', { parent_id: t.id, by_actor: 'cc', question: '选哪个?', options: ['甲', '乙'], to_decider: 'admin' });
    expect((await call('list_pending', { actor: 'admin' })).decisions[0].options).toHaveLength(2);
    await call('answer_clarification', { clar_task_id: raised.clarTask.id, by_actor: 'admin', answer: '甲' });
    expect((await call('get_task', { id: t.id })).task.hold).toBeNull();
    await call('submit_output', { task_id: t.id, by_actor: 'cc', outputs_md: '- 产物', summary: '完事' });
    await call('comment', { task_id: t.id, actor: 'cc', body: '顺利' });
    await call('handoff', { task_id: t.id, by_actor: 'cc', to_actor: 'admin', to_role: 'tester', to_state: 'testing' });
    await call('handoff', { task_id: t.id, by_actor: 'admin', to_actor: 'admin', to_role: 'tester', to_state: 'done' });
    await call('update_task', { task_id: t.id, by_actor: 'admin', priority: 'hi' });
    const scratch = await call('create_task', { title: '建错了' });
    await call('link_edge', { from_task: t.id, to_task: scratch.id, type: 'depends_on' });
    await call('delete_task', { task_id: scratch.id, by_actor: 'admin' });
    const final = await call('get_task', { id: t.id });
    expect(final.task.state).toBe('done');
    expect(final.task.priority).toBe('hi');
    expect(final.edges.out).toHaveLength(0); // 被删任务的边级联清掉
    // 守卫在协议线上同样是人话
    const err: any = await client.callTool({ name: 'claim', arguments: { task_id: t.id, actor: 'cc' } });
    expect(err.isError).toBe(true);
    expect(err.content[0].text).toContain('已在 admin 手里');
    await client.close();
    await server.close();
  });

  it('写工具经 MCP 线上往返: claim 改变 DB', async () => {
    const db = openDb(':memory:');
    const service = new RelayService(db, mkdtempSync(join(tmpdir(), 'relay-w-')));
    service.registerActor({ id: 'a', name: 'A', type: 'agent' });
    const t = service.createTask({ title: 'demo' });
    const server = buildServer(service);
    const [clientT, serverT] = InMemoryTransport.createLinkedPair();
    await server.connect(serverT);
    const client = new Client({ name: 'test', version: '0' });
    await client.connect(clientT);
    const res: any = await client.callTool({ name: 'claim', arguments: { task_id: t.id, actor: 'a', role: 'executor' } });
    const task = JSON.parse(res.content[0].text);
    expect(task.currentActor).toBe('a');
    expect(getTask(db, t.id)!.currentActor).toBe('a'); // DB 真的改了
    await client.close();
    await server.close();
  });
});
