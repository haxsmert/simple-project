import { describe, it, expect } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { openDb } from '../../src/db/connection';

describe('openDb', () => {
  it('建出四张核心表', () => {
    const db = openDb(':memory:');
    const names = (db.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name",
    ).all() as { name: string }[]).map((r) => r.name);
    expect(names).toContain('actors');
    expect(names).toContain('tasks');
    expect(names).toContain('edges');
    expect(names).toContain('events');
  });

  it('重开已是新 schema 的库不得重跑迁移: hold 值原样保留(guard 误判会把挂起全抹掉 —— 踩过)', () => {
    const path = join(mkdtempSync(join(tmpdir(), 'relay-reopen-')), 'x.db');
    const db1 = openDb(path);
    db1.exec(`INSERT INTO actors VALUES ('a','A','agent','2026-01-01');
      INSERT INTO tasks (id,title,state,hold,created_at,updated_at) VALUES ('R-1','t','planning','confirm','2026-01-01','2026-01-01');`);
    db1.close();
    const db2 = openDb(path); // 重开: 迁移 guard 不得触发重建
    expect((db2.prepare("SELECT hold FROM tasks WHERE id='R-1'").get() as { hold: string }).hold).toBe('confirm');
  });

  it('旧库迁移: kind 白名单没有 plan 的 events 表被重建 —— 老数据保留、能插 plan 事件、索引挂回新表', () => {
    // 手工造一个"迁移前"的库: events 的 CHECK 还不认识 'plan', 也没有 to_actor 等新列
    const path = join(mkdtempSync(join(tmpdir(), 'relay-mig-')), 'old.db');
    const legacy = new Database(path);
    legacy.exec(`
      CREATE TABLE actors (id TEXT PRIMARY KEY, name TEXT NOT NULL, type TEXT NOT NULL, handle TEXT, created_at TEXT NOT NULL);
      CREATE TABLE tasks (id TEXT PRIMARY KEY, title TEXT NOT NULL, parent_id TEXT, state TEXT NOT NULL,
        current_actor TEXT, current_role TEXT, goal TEXT, plan_md TEXT, outputs_md TEXT, summary TEXT,
        priority TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
      CREATE TABLE edges (id TEXT PRIMARY KEY, from_task TEXT NOT NULL, to_task TEXT NOT NULL, type TEXT NOT NULL, created_at TEXT NOT NULL);
      CREATE TABLE events (
        id TEXT PRIMARY KEY, task_id TEXT NOT NULL, actor_id TEXT NOT NULL,
        kind TEXT NOT NULL CHECK (kind IN ('handoff','comment','output','clarify','decide','claim')),
        role_from TEXT, role_to TEXT, body TEXT, created_at TEXT NOT NULL);
      CREATE INDEX idx_events_task ON events(task_id);
      INSERT INTO actors VALUES ('a','A','agent',NULL,'2026-01-01');
      INSERT INTO tasks (id,title,state,created_at,updated_at) VALUES
        ('R-1','t','planning','2026-01-01','2026-01-01'),
        ('R-2','计划待确认','awaiting_confirm','2026-01-01','2026-01-01'),
        ('R-3','被挂起的父任务','awaiting_decision','2026-01-01','2026-01-01'),
        ('R-4','待确认: 问题卡','awaiting_decision','2026-01-01','2026-01-01');
      INSERT INTO edges VALUES ('ed1','R-4','R-3','clarifies','2026-01-01');
      INSERT INTO events (id,task_id,actor_id,kind,body,created_at) VALUES ('e1','R-1','a','comment','老事件','2026-01-01');
    `);
    legacy.close();

    const db = openDb(path);
    // 老事件原样保留
    expect((db.prepare("SELECT body FROM events WHERE id='e1'").get() as { body: string }).body).toBe('老事件');
    // 六态翻译成 阶段×挂起: 待确认→计划站挂 confirm; 待决策的父任务→执行站挂 decision; 问题卡(有 clarifies 出边)→计划站挂 decision
    const pos = (id: string) => db.prepare('SELECT state, hold FROM tasks WHERE id=?').get(id) as { state: string; hold: string | null };
    expect(pos('R-1')).toEqual({ state: 'planning', hold: null });
    expect(pos('R-2')).toEqual({ state: 'planning', hold: 'confirm' });
    expect(pos('R-3')).toEqual({ state: 'executing', hold: 'decision' });
    expect(pos('R-4')).toEqual({ state: 'planning', hold: 'decision' });
    // 新 kind 插得进去(旧 CHECK 已换掉)
    db.prepare(
      'INSERT INTO events (id,task_id,actor_id,kind,created_at) VALUES (?,?,?,?,?)',
    ).run('e2', 'R-1', 'a', 'plan', '2026-01-02');
    expect((db.prepare('SELECT COUNT(*) c FROM events').get() as { c: number }).c).toBe(2);
    // 索引跟着旧表陪葬后要补回来, 否则新表裸奔
    const idx = db.prepare(
      "SELECT tbl_name FROM sqlite_master WHERE type='index' AND name='idx_events_task'",
    ).get() as { tbl_name: string } | undefined;
    expect(idx?.tbl_name).toBe('events');
    // 临时表不残留
    expect(db.prepare("SELECT name FROM sqlite_master WHERE name='events_legacy'").get()).toBeUndefined();
  });
});
