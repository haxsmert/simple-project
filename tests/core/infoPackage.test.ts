import { describe, it, expect } from 'vitest';
import { openDb } from '../../src/db/connection';
import { createActor } from '../../src/repo/actors';
import { createTask } from '../../src/repo/tasks';
import { createEdge } from '../../src/repo/edges';
import { raiseClarification } from '../../src/core/clarification';
import { assemblePackage } from '../../src/core/infoPackage';

describe('assemblePackage', () => {
  it('组装四槽位 + 递归 + 依赖产出 + 待确认', () => {
    const db = openDb(':memory:');
    createActor(db, { id: 'exec', name: 'A', type: 'agent' });

    const project = createTask(db, { title: '项目' });
    const task = createTask(db, {
      title: '搭建数据层', parentId: project.id, state: 'executing',
      currentActor: 'exec', currentRole: 'executor',
      goal: '建三张表', inputsMd: '计划: ...', outputsMd: '产物: schema.sql', summary: '进行中',
    });
    createTask(db, { title: '子任务1', parentId: task.id });

    const dep = createTask(db, { title: 'MCP 接口', state: 'done', summary: '锁定字段命名' });
    createEdge(db, { fromTask: task.id, toTask: dep.id, type: 'depends_on' });

    raiseClarification(db, { parentId: task.id, byActor: 'exec', question: '附件?' });

    const pkg = assemblePackage(db, task.id);

    expect(pkg.breadcrumb.map((t) => t.id)).toEqual([project.id]);
    expect(pkg.inputs.goal).toBe('建三张表');
    expect(pkg.inputs.depOutputs).toHaveLength(1);
    expect(pkg.inputs.depOutputs[0].summary).toBe('锁定字段命名');
    expect(pkg.outputs.outputsMd).toBe('产物: schema.sql');
    expect(pkg.clarifications).toHaveLength(1);
    expect(pkg.subtasks.map((t) => t.title)).toContain('子任务1');
    expect(pkg.thread.length).toBeGreaterThanOrEqual(1); // clarify 事件
  });
});
