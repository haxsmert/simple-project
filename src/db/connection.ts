import Database from 'better-sqlite3';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));

export type DB = Database.Database;

export function openDb(path: string = ':memory:'): DB {
  const db = new Database(path);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.exec(readFileSync(join(here, 'schema.sql'), 'utf8'));
  // 安全迁移: 已存在的 db 文件不会被 CREATE TABLE IF NOT EXISTS 重建, 需手动补列
  const cols = db.prepare('PRAGMA table_info(tasks)').all() as { name: string }[];
  if (!cols.some((c) => c.name === 'rank')) db.exec('ALTER TABLE tasks ADD COLUMN rank REAL');
  const ev = db.prepare('PRAGMA table_info(events)').all() as { name: string }[];
  if (!ev.some((c) => c.name === 'to_actor')) db.exec('ALTER TABLE events ADD COLUMN to_actor TEXT REFERENCES actors(id)');
  if (!ev.some((c) => c.name === 'state_from')) db.exec('ALTER TABLE events ADD COLUMN state_from TEXT');
  if (!ev.some((c) => c.name === 'state_to')) db.exec('ALTER TABLE events ADD COLUMN state_to TEXT');
  // kind 白名单扩了 'plan'(写了计划): SQLite 改不了 CHECK, 旧库只能重建 events 表
  const evSql = (db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='events'").get() as { sql: string }).sql;
  if (!evSql.includes("'plan'")) {
    db.transaction(() => {
      db.exec('ALTER TABLE events RENAME TO events_legacy'); // 索引跟旧表走, 重建完要补
      db.exec(readFileSync(join(here, 'schema.sql'), 'utf8'));
      db.exec(
        `INSERT INTO events (id,task_id,actor_id,kind,role_from,role_to,to_actor,state_from,state_to,body,created_at)
         SELECT id,task_id,actor_id,kind,role_from,role_to,to_actor,state_from,state_to,body,created_at FROM events_legacy`,
      );
      db.exec('DROP TABLE events_legacy');
      db.exec('CREATE INDEX IF NOT EXISTS idx_events_task ON events(task_id)');
    })();
  }
  return db;
}
