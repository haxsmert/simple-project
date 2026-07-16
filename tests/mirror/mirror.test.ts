import { describe, it, expect } from 'vitest';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDb } from '../../src/db/connection';
import { createTask } from '../../src/repo/tasks';
import { assemblePackage } from '../../src/core/infoPackage';
import { renderTaskMarkdown } from '../../src/mirror/markdown';
import { mirrorTask } from '../../src/mirror/writer';

describe('文件镜像', () => {
  it('渲染出带 frontmatter 与四槽位的 Markdown', () => {
    const db = openDb(':memory:');
    const t = createTask(db, {
      id: 'R-142', title: '搭建数据层', state: 'executing',
      goal: '建三张表', outputsMd: '产物: schema.sql',
    });
    const md = renderTaskMarkdown(assemblePackage(db, t.id));

    expect(md).toContain('id: R-142');
    expect(md).toContain('# 搭建数据层');
    expect(md).toContain('## 输入 Inputs');
    expect(md).toContain('建三张表');
    expect(md).toContain('## 产出 Outputs');
    expect(md).toContain('产物: schema.sql');
    expect(md).toContain('## 交互记录 Thread');
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
