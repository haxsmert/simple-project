import { mkdirSync, rmSync } from 'node:fs';
import { dirname } from 'node:path';
import { openDb, type DB } from './db/connection';
import { createActor } from './repo/actors';
import { createTask } from './repo/tasks';
import { createEdge } from './repo/edges';
import { raiseClarification } from './core/clarification';
import { mirrorTask } from './mirror/writer';

export function seed(db: DB, dir: string): { taskCount: number; files: string[] } {
  const you = createActor(db, { id: 'you', name: '你', type: 'human' });
  const execA = createActor(db, { id: 'agent-exec-a', name: '执行·A', type: 'agent', handle: 'mcp:exec-a' });

  const project = createTask(db, {
    id: 'R-115', title: 'Relay MVP · 数据层', currentActor: you.id, currentRole: 'planner',
  });
  const task = createTask(db, {
    id: 'R-142', title: '搭建 SQLite 数据层与任务模型', parentId: project.id,
    state: 'executing', currentActor: execA.id, currentRole: 'executor',
    goal: '为 Relay 建立单一真相源:任务/行动者/关系边三张表, 覆盖递归与六态状态机。',
    inputsMd: '确认后的计划:\n- [x] 三张表 + 触发器\n- [x] 依赖 R-140 字段命名',
    outputsMd: '- schema/001_init.sql (已提交)\n- src/model/task.ts (已提交)',
    summary: '三张表已落地, 递归用 parent_id 自引用; 卡在信息包存储格式。', priority: 'hi',
  });
  createTask(db, { id: 'R-143', title: 'tasks 表 + 自引用递归', parentId: task.id, state: 'done' });
  createTask(db, { id: 'R-145', title: 'actors 表 + 类型枚举', parentId: task.id, state: 'done' });
  createTask(db, { id: 'R-147', title: '信息包四槽位存储', parentId: task.id, state: 'planning' });

  const dep = createTask(db, { id: 'R-140', title: 'MCP 工具集接口设计', state: 'done', summary: '锁定 claim/handoff/raise 字段命名。' });
  createEdge(db, { fromTask: task.id, toTask: dep.id, type: 'depends_on' });

  // 执行者卡住 → 触发待确认(会新建一个 R-<n> 待决策任务)
  raiseClarification(db, {
    parentId: task.id, byActor: execA.id,
    question: '四槽位信息包是否允许富文本/附件?',
    options: ['纯 Markdown + 外链, 附件走镜像目录', '结构化 JSON 富内容, DB 存 blob'],
    toDecider: you.id,
  });

  const ids = (db.prepare('SELECT id FROM tasks ORDER BY id').all() as { id: string }[]).map((r) => r.id);
  const files = ids.map((id) => mirrorTask(db, dir, id));
  return { taskCount: ids.length, files };
}

// 从干净状态跑一次 seed 到指定 db 文件 + 镜像目录; 可重复运行(每次先重置)
export function runSeedCli(dbPath: string, dir: string): { taskCount: number; files: string[] } {
  mkdirSync(dirname(dbPath), { recursive: true });
  for (const f of [dbPath, `${dbPath}-wal`, `${dbPath}-shm`]) {
    rmSync(f, { force: true });
  }
  const db = openDb(dbPath);
  return seed(db, dir);
}

// CLI: npm run seed → 重置 data/relay.db 并镜像到 data/tasks/
if (import.meta.url === `file://${process.argv[1]}`) {
  const res = runSeedCli('data/relay.db', 'data/tasks');
  console.log(`✅ seed 完成: ${res.taskCount} 个任务, 镜像 ${res.files.length} 个文件到 data/tasks/`);
}
