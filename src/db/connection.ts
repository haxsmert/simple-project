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
  const schema = readFileSync(join(here, 'schema.sql'), 'utf8');
  db.exec(schema);
  // 安全迁移: 已存在的 db 文件不会被 CREATE TABLE IF NOT EXISTS 重建, 需手动补列
  const cols = db.prepare('PRAGMA table_info(tasks)').all() as { name: string }[];
  if (!cols.some((c) => c.name === 'rank')) db.exec('ALTER TABLE tasks ADD COLUMN rank REAL');
  // 字段语义大扫除(2026-07-18): inputs_md 存的一直是"计划" → 改名 plan_md, 名实相符
  if (cols.some((c) => c.name === 'inputs_md')) db.exec('ALTER TABLE tasks RENAME COLUMN inputs_md TO plan_md');
  // actors.handle 只写不读零消费 → 删列
  const acols = db.prepare('PRAGMA table_info(actors)').all() as { name: string }[];
  if (acols.some((c) => c.name === 'handle')) db.exec('ALTER TABLE actors DROP COLUMN handle');
  // 关系边收敛为两种: blocks 与 depends_on 互为反向(翻转保留信息), spawns 是 clarifies 的反向冗余(直接删)
  db.exec("UPDATE edges SET type='depends_on', from_task=to_task, to_task=from_task WHERE type='blocks'"); // SET 右侧取旧值, swap 安全
  db.exec("DELETE FROM edges WHERE type='spawns'");
  const ev = db.prepare('PRAGMA table_info(events)').all() as { name: string }[];
  if (!ev.some((c) => c.name === 'to_actor')) db.exec('ALTER TABLE events ADD COLUMN to_actor TEXT REFERENCES actors(id)');
  if (!ev.some((c) => c.name === 'state_from')) db.exec('ALTER TABLE events ADD COLUMN state_from TEXT');
  if (!ev.some((c) => c.name === 'state_to')) db.exec('ALTER TABLE events ADD COLUMN state_to TEXT');
  if (!ev.some((c) => c.name === 'hold_from')) db.exec('ALTER TABLE events ADD COLUMN hold_from TEXT');
  if (!ev.some((c) => c.name === 'hold_to')) db.exec('ALTER TABLE events ADD COLUMN hold_to TEXT');

  const tableSql = (name: string): string =>
    (db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name=?").get(name) as { sql: string }).sql;

  // kind 白名单扩过 'plan'(写了计划)与 'update'(更新任务信息): SQLite 改不了 CHECK, 旧库只能重建 events 表
  if (!tableSql('events').includes("'update'")) {
    db.transaction(() => {
      db.exec('ALTER TABLE events RENAME TO events_legacy'); // 索引跟旧表走, 重建完要补
      db.exec(schema);
      db.exec(
        `INSERT INTO events (id,task_id,actor_id,kind,role_from,role_to,to_actor,state_from,state_to,hold_from,hold_to,body,created_at)
         SELECT id,task_id,actor_id,kind,role_from,role_to,to_actor,state_from,state_to,hold_from,hold_to,body,created_at FROM events_legacy`,
      );
      db.exec('DROP TABLE events_legacy');
      db.exec('CREATE INDEX IF NOT EXISTS idx_events_task ON events(task_id)');
    })();
  }

  // 六态拆两字段(2026-07-17 模型定调): state 缩为主干四阶段, 挂起独立成 hold 列。
  // 旧库重建 tasks 表并翻译: awaiting_confirm → planning+confirm(确认是"从计划往前走"的把关, 任务还在计划站);
  // awaiting_decision → 问题卡(有 clarifies 出边)归 planning+decision, 被挂起的父任务归 executing+decision(旧模型只有执行中能提问)。
  // guard 必须用 PRAGMA 判"hold 列存在与否", 不能搜建表 SQL 文本:
  // 列名 hold 在 SQL 里不带引号, 文本搜索会把新库也误判成旧库 → 每次重开都重跑重建, 把 hold 全抹成 NULL(踩过)
  if (!cols.some((c) => c.name === 'hold')) {
    // tasks 被 events/edges 外键引用: 默认 RENAME 会把它们的引用改写指向 legacy 表, drop 后悬空 —— 必须开 legacy 模式让引用按字面留在 'tasks'
    db.pragma('foreign_keys = OFF');
    db.pragma('legacy_alter_table = ON');
    db.transaction(() => {
      db.exec('ALTER TABLE tasks RENAME TO tasks_legacy');
      db.exec(schema);
      db.exec(
        `INSERT INTO tasks (id,title,parent_id,state,hold,current_actor,current_role,goal,plan_md,outputs_md,summary,priority,rank,created_at,updated_at)
         SELECT id,title,parent_id,
           CASE state
             WHEN 'awaiting_confirm' THEN 'planning'
             WHEN 'awaiting_decision' THEN CASE WHEN EXISTS(SELECT 1 FROM edges e WHERE e.from_task=tasks_legacy.id AND e.type='clarifies') THEN 'planning' ELSE 'executing' END
             ELSE state END,
           CASE state WHEN 'awaiting_confirm' THEN 'confirm' WHEN 'awaiting_decision' THEN 'decision' ELSE NULL END,
           current_actor,current_role,goal,plan_md,outputs_md,summary,priority,rank,created_at,updated_at
         FROM tasks_legacy`,
      );
      db.exec('DROP TABLE tasks_legacy');
      db.exec('CREATE INDEX IF NOT EXISTS idx_tasks_parent ON tasks(parent_id)');
      db.exec('CREATE INDEX IF NOT EXISTS idx_tasks_state ON tasks(state)');
      // 事件里的老六态值同步翻译(否则「经过」拿新映射表渲染不出老值)
      db.exec(
        `UPDATE events SET
           hold_from  = CASE state_from WHEN 'awaiting_confirm' THEN 'confirm' WHEN 'awaiting_decision' THEN 'decision' ELSE hold_from END,
           state_from = CASE state_from WHEN 'awaiting_confirm' THEN 'planning' WHEN 'awaiting_decision' THEN 'executing' ELSE state_from END,
           hold_to    = CASE state_to WHEN 'awaiting_confirm' THEN 'confirm' WHEN 'awaiting_decision' THEN 'decision' ELSE hold_to END,
           state_to   = CASE state_to WHEN 'awaiting_confirm' THEN 'planning' WHEN 'awaiting_decision' THEN 'executing' ELSE state_to END
         WHERE state_from IN ('awaiting_confirm','awaiting_decision') OR state_to IN ('awaiting_confirm','awaiting_decision')`,
      );
    })();
    db.pragma('legacy_alter_table = OFF');
    db.pragma('foreign_keys = ON');
  }
  return db;
}
