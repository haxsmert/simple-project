import { describe, it, expect } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { openDb } from '../../src/db/connection';
import { RelayService } from '../../src/service/relay';
import { buildServer } from '../../src/mcp/server';

// 审计第 3 轮(2026-07-19 loop): agent 只靠工具与报错在协议线上走"项目=大号任务"全流程 ——
// 新模型的守卫在 MCP 线上必须**拦得住且指得了路**(报错要含下一步动作词, 不是光说不行)
describe('MCP 线上: 项目模型守卫的拦截与指路', () => {
  async function wire() {
    const db = openDb(':memory:');
    const service = new RelayService(db, mkdtempSync(join(tmpdir(), 'relay-wg-')));
    const server = buildServer(service);
    const [ct, st] = InMemoryTransport.createLinkedPair();
    await server.connect(st);
    const client = new Client({ name: 'audit', version: '0' });
    await client.connect(ct);
    const call = async (name: string, args: Record<string, unknown>) => {
      const res = await client.callTool({ name, arguments: args }) as { isError?: boolean; content: Array<{ text: string }> };
      return { err: !!res.isError, text: res.content[0].text };
    };
    return { call, close: async () => { await client.close(); await server.close(); } };
  }

  it('全流程通 + 六道守卫线上拦截且报错指路(目标/两态/不挂起/重开)', async () => {
    const { call, close } = await wire();
    await call('register_actor', { id: 'admin', name: 'admin', type: 'human' });
    await call('register_actor', { id: 'cc', name: 'CC', type: 'agent' });

    // 无 goal 开项目 → 拦 + 指路("目标")
    const bare = await call('create_task', { title: '裸项目' });
    expect(bare.err).toBe(true);
    expect(bare.text).toContain('目标');

    // 开项目(建即执行中) → 建任务 → agent 领活到交验全通
    const proj = JSON.parse((await call('create_task', { title: '演练方向', goal: '走通全流程' })).text);
    expect(proj.state).toBe('executing');
    const t = JSON.parse((await call('create_task', { title: '活', goal: 'g', parent_id: proj.id })).text);
    await call('claim', { task_id: t.id, actor: 'cc', role: 'planner' });
    await call('submit_plan', { task_id: t.id, by_actor: 'cc', plan_md: '- [ ] x' });
    await call('handoff', { task_id: t.id, by_actor: 'cc', to_actor: 'cc', to_role: 'executor', to_state: 'executing' });
    await call('submit_output', { task_id: t.id, by_actor: 'cc', summary: '完事' });
    const toTest = await call('handoff', { task_id: t.id, by_actor: 'cc', to_actor: 'admin', to_role: 'tester', to_state: 'testing' });
    expect(toTest.err).toBe(false);

    // 项目乱流转 / 对项目提问 → 拦 + 指路
    const badMove = await call('handoff', { task_id: proj.id, by_actor: 'admin', to_actor: 'admin', to_role: 'planner', to_state: 'testing' });
    expect(badMove.err).toBe(true);
    expect(badMove.text).toContain('两态');
    const askProj = await call('raise_clarification', { parent_id: proj.id, by_actor: 'cc', question: '?' });
    expect(askProj.err).toBe(true);
    expect(askProj.text).toContain('项目不挂起');

    // 完结(带遗留 testing 任务) → 死项目操作拦 + 指路("重开"); 找活面死活不可见
    await call('handoff', { task_id: proj.id, by_actor: 'admin', to_actor: 'admin', to_role: 'planner', to_state: 'done' });
    const deadPush = await call('handoff', { task_id: t.id, by_actor: 'admin', to_actor: 'admin', to_role: 'tester', to_state: 'done' });
    expect(deadPush.err).toBe(true);
    expect(deadPush.text).toContain('重开');
    const deadNew = await call('create_task', { title: '新活', parent_id: proj.id });
    expect(deadNew.err).toBe(true);
    expect(deadNew.text).toContain('重开');
    expect(JSON.parse((await call('list_tasks', { state: 'testing' })).text)).toHaveLength(0);

    // get_task(项目)线上附全景动静
    const pkg = JSON.parse((await call('get_task', { id: proj.id })).text);
    expect(pkg.projectActivity!.length).toBeGreaterThan(0);

    // 重开 → 找活面复活
    await call('handoff', { task_id: proj.id, by_actor: 'admin', to_actor: 'admin', to_role: 'planner', to_state: 'executing' });
    expect(JSON.parse((await call('list_tasks', { state: 'testing' })).text)).toHaveLength(1);
    await close();
  });
});
