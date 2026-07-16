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
  return db;
}
