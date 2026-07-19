import { describe, it, expect } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDb } from '../../src/db/connection';
import { RelayService } from '../../src/service/relay';
import { listMyTasksTool, getTaskTool } from '../../src/mcp/tools';

function svc() {
  const db = openDb(':memory:');
  return new RelayService(db, mkdtempSync(join(tmpdir(), 'relay-mcp-')));
}

describe('MCP read tools', () => {
  it('list_my_tasks 返回该 actor 的任务 JSON', () => {
    const service = svc();
    service.registerActor({ id: 'a', name: 'A', type: 'agent' });
    service.createTask({ title: 't', goal: 'g', currentActor: 'a', currentRole: 'executor' });
    const res = listMyTasksTool.handler(service, { actor: 'a' });
    const data = JSON.parse(res.content[0].text);
    expect(data.map((t: any) => t.title)).toContain('t');
  });

  it('get_task 返回信息包 JSON(含四槽位键)', () => {
    const service = svc();
    const t = service.createTask({ title: 't', goal: '目标' });
    const res = getTaskTool.handler(service, { id: t.id });
    const pkg = JSON.parse(res.content[0].text);
    expect(pkg.task.id).toBe(t.id);
    expect(pkg.inputs.goal).toBe('目标');
    expect(pkg).toHaveProperty('outputs');
    expect(pkg).toHaveProperty('thread');
  });
});
