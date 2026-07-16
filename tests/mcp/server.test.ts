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
