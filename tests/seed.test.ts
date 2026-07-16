import { describe, it, expect } from 'vitest';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDb } from '../src/db/connection';
import { seed } from '../src/seed';
import { getTask } from '../src/repo/tasks';

describe('seed 端到端', () => {
  it('铺出 Relay 场景, 触发待确认挂起, 镜像等量文件', () => {
    const db = openDb(':memory:');
    const dir = mkdtempSync(join(tmpdir(), 'relay-seed-'));
    const res = seed(db, dir);

    expect(res.taskCount).toBeGreaterThanOrEqual(6);
    expect(res.files.length).toBe(res.taskCount);
    // R-142 因执行者触发待确认而被挂起
    expect(getTask(db, 'R-142')!.state).toBe('awaiting_decision');
    // 镜像文件真的写出来了
    expect(readFileSync(join(dir, 'R-142.md'), 'utf8')).toContain('# 搭建 SQLite 数据层与任务模型');
  });
});
