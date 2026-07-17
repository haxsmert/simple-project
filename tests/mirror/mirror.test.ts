import { describe, it, expect } from 'vitest';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDb } from '../../src/db/connection';
import { createActor } from '../../src/repo/actors';
import { createTask } from '../../src/repo/tasks';
import { raiseClarification } from '../../src/core/clarification';
import { handoff } from '../../src/core/handoff';
import { assemblePackage } from '../../src/core/infoPackage';
import { renderTaskMarkdown } from '../../src/mirror/markdown';
import { mirrorTask } from '../../src/mirror/writer';

describe('文件镜像', () => {
  it('镜像说人话且信息全: frontmatter 带 hold, 正文中文槽位, 无中英混排黑话', () => {
    const db = openDb(':memory:');
    const t = createTask(db, {
      id: 'R-142', title: '搭建数据层', state: 'executing',
      goal: '建三张表', planMd: '- [ ] 先建 schema', outputsMd: '产物: schema.sql',
    });
    const md = renderTaskMarkdown(assemblePackage(db, t.id));

    expect(md).toContain('id: R-142');
    expect(md).toContain('hold: ');            // 挂起是核心字段, 脱离应用也读得到
    expect(md).toContain('# 搭建数据层');
    expect(md).toContain('**执行中**');        // 状态一眼可见(人话)
    expect(md).toContain('## 任务内容');
    expect(md).toContain('建三张表');
    expect(md).toContain('先建 schema');
    expect(md).toContain('## 做出了什么');
    expect(md).toContain('产物: schema.sql');
    expect(md).not.toContain('Inputs');        // 中英混排标题(纯装饰)已清
    expect(md).not.toContain('Thread');
  });

  it('挂起/问题/经过 的故事完整: 问题不在子任务重复列, 经过无 "(? → xx)" 黑话', () => {
    const db = openDb(':memory:');
    createActor(db, { id: 'x', name: 'X', type: 'agent' });
    createActor(db, { id: 'admin', name: 'admin', type: 'human' });
    const t = createTask(db, { id: 'R-1', title: '导出脚本', state: 'executing', currentActor: 'x', currentRole: 'executor', planMd: '- [ ] x' });
    raiseClarification(db, { parentId: t.id, byActor: 'x', question: '含子任务吗?', options: ['含', '不含'], toDecider: 'admin' });
    const md = renderTaskMarkdown(assemblePackage(db, t.id));

    expect(md).toContain('hold: decision');
    expect(md).toContain('· 等决策');                 // 标题行亮挂起
    expect(md).toContain('## 问题(待确认)');
    expect(md).toContain('- [ ] 含子任务吗?(R-2)');
    expect(md).not.toContain('## 子任务');            // 问题卡不再在子任务里重复列
    expect(md).toContain('## 经过');
    expect(md).toContain('提了个问题等人决定: 含子任务吗?');
    expect(md).not.toContain('(?');                   // 不再有 "(? → planner)" 这类问号黑话

    // 换手事件说人话: 转交给谁 · 挂起/阶段怎么变
    const t2 = createTask(db, { id: 'R-9', title: '另一个', state: 'planning', currentActor: 'x', currentRole: 'planner', planMd: '- [ ] y' });
    handoff(db, { taskId: t2.id, byActor: 'x', toActor: 'admin', toRole: 'decider', toHold: 'confirm', note: '请拍板' });
    const md2 = renderTaskMarkdown(assemblePackage(db, t2.id));
    expect(md2).toContain('转交给 admin · 提交等确认: 请拍板');
  });

  it('把任务写成 <dir>/<id>.md 文件', () => {
    const db = openDb(':memory:');
    createTask(db, { id: 'R-7', title: '镜像我' });
    const dir = mkdtempSync(join(tmpdir(), 'relay-mirror-'));
    const path = mirrorTask(db, dir, 'R-7');

    expect(path).toBe(join(dir, 'R-7.md'));
    expect(readFileSync(path, 'utf8')).toContain('# 镜像我');
  });
});
