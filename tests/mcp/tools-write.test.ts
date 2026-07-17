import { describe, it, expect } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDb } from '../../src/db/connection';
import { getTask } from '../../src/repo/tasks';
import { RelayService } from '../../src/service/relay';
import {
  claimTool, handoffTool, submitPlanTool, submitOutputTool,
  raiseClarificationTool, answerClarificationTool, commentTool, ALL_TOOLS,
} from '../../src/mcp/tools';

function svc() {
  const db = openDb(':memory:');
  const service = new RelayService(db, mkdtempSync(join(tmpdir(), 'relay-tw-')));
  service.registerActor({ id: 'x', name: 'X', type: 'agent' });
  service.registerActor({ id: 'you', name: '你', type: 'human' });
  return { db, service };
}

describe('MCP write tools', () => {
  it('claim + submit_output + comment', () => {
    const { db, service } = svc();
    const t = service.createTask({ title: 't' });
    claimTool.handler(service, { task_id: t.id, actor: 'x', role: 'executor' });
    submitOutputTool.handler(service, { task_id: t.id, by_actor: 'x', summary: '完成' });
    commentTool.handler(service, { task_id: t.id, actor: 'x', body: 'note' });
    expect(getTask(db, t.id)!.currentActor).toBe('x');
    expect(getTask(db, t.id)!.summary).toBe('完成');
  });

  it('handoff 换手', () => {
    const { db, service } = svc();
    const t = service.createTask({ title: 't', state: 'executing', currentActor: 'x', currentRole: 'executor' });
    handoffTool.handler(service, { task_id: t.id, by_actor: 'x', to_actor: 'you', to_role: 'tester', to_state: 'testing' });
    expect(getTask(db, t.id)!.state).toBe('testing');
  });

  it('raise + answer 待确认', () => {
    const { db, service } = svc();
    const p = service.createTask({ title: 'p', state: 'executing', currentActor: 'x', currentRole: 'executor' });
    const raised = JSON.parse(raiseClarificationTool.handler(service, { parent_id: p.id, by_actor: 'x', question: 'Q', to_decider: 'you' }).content[0].text);
    expect(getTask(db, p.id)!.state).toBe('awaiting_decision');
    answerClarificationTool.handler(service, { clar_task_id: raised.clarTask.id, by_actor: 'you', answer: 'A' });
    expect(getTask(db, p.id)!.state).toBe('executing');
  });

  it('submit_plan 写计划(agent 规划者也要有写计划的通道, 不能只有 Web 界面能写)', () => {
    const { db, service } = svc();
    const t = service.createTask({ title: 't' });
    submitPlanTool.handler(service, { task_id: t.id, by_actor: 'x', plan_md: '- [ ] 先建表' });
    expect(getTask(db, t.id)!.inputsMd).toBe('- [ ] 先建表');
  });

  it('ALL_TOOLS 含全部 9 个工具', () => {
    expect(ALL_TOOLS.map((t) => t.name).sort()).toEqual(
      ['answer_clarification', 'claim', 'comment', 'get_task', 'handoff', 'list_my_tasks', 'raise_clarification', 'submit_output', 'submit_plan'],
    );
  });
});
