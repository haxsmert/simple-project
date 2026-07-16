# Relay 核心地基 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 用 TDD 建成 Relay 的核心机制库——递归任务 + 关系边 + 六态状态机 + 换手 + 待确认闭环 + 信息包组装 + 文件镜像——收尾以一个可运行的 seed 脚本演示端到端。

**Architecture:** SQLite 为单一真相源(WAL 模式)。分层:`db`(连接/schema) → `model`(类型) → `repo`(四张表的读写) → `core`(状态机/换手/待确认/信息包组装) → `mirror`(DB→Markdown 单向镜像)。core 操作是纯 DB 逻辑, 镜像是独立函数, 便于单测隔离; "变更即镜像"的门面留给后续 MCP/Web 入口层接。

**Tech Stack:** TypeScript (ESM) · Node ≥ 20 · better-sqlite3 (WAL) · vitest · tsx。本计划**不含** MCP server 与 Web UI(见后续计划 2、3)。

## Global Constraints

- **语言/模块**: TypeScript, ESM (`"type":"module"`), 导入一律**无扩展名**(靠 tsx/vitest 解析)。
- **Node 版本**: ≥ 20 (better-sqlite3 ^11 要求)。
- **数据库**: SQLite + better-sqlite3, 开启 `journal_mode=WAL` 与 `foreign_keys=ON`。SQLite 为真相源。
- **命名**: 数据库列 `snake_case`, TypeScript 字段 `camelCase`, 每个 repo 内做 row↔对象映射。
- **任务 ID**: 形如 `R-<n>` (`nextTaskId` 取现有最大后缀 +1); 边/事件 ID 用 `uid(前缀)`。
- **信息包内容**: 只存 Markdown 文本 + 外链, 不做富文本/DB blob(spec §6 已定方案 A)。
- **镜像方向**: 单向 DB→Markdown, 输出到 `tasks/<id>.md`。`tasks/` 可提交、可 diff。
- **测试**: vitest, 显式 `import { describe, it, expect } from 'vitest'`(不开 globals); 单测用 `openDb(':memory:')`。
- **提交信息**: 中文, 开头带一个 emoji。每个任务末尾提交一次。
- **枚举锁定**(全计划统一, 不得变体):
  - `ActorType = 'human' | 'agent'`
  - `Role = 'planner' | 'executor' | 'tester' | 'questioner' | 'decider'`
  - `TaskState = 'planning' | 'awaiting_confirm' | 'executing' | 'awaiting_decision' | 'testing' | 'done'`
  - `EdgeType = 'blocks' | 'depends_on' | 'clarifies' | 'spawns'`
  - `EventKind = 'handoff' | 'comment' | 'output' | 'clarify' | 'decide' | 'claim'`

---

## 文件结构

```
package.json · tsconfig.json · vitest.config.ts · .gitignore
src/
  util.ts                 -- now() / uid()
  model/types.ts          -- 全部枚举与行对象接口
  db/schema.sql           -- 四张表 DDL + 索引
  db/connection.ts        -- openDb(): 连接 + WAL + 建表
  repo/actors.ts          -- createActor/getActor/listActors
  repo/tasks.ts           -- nextTaskId/createTask/getTask/updateTask/listChildren/listRoots/ancestors
  repo/edges.ts           -- createEdge/edgesFrom/edgesTo
  repo/events.ts          -- appendEvent/listEvents
  core/stateMachine.ts    -- TRANSITIONS/canTransition/defaultNext
  core/handoff.ts         -- handoff()
  core/clarification.ts   -- raiseClarification()/answerClarification()
  core/infoPackage.ts     -- assemblePackage(): 四槽位 + 递归 + 边
  mirror/markdown.ts      -- renderTaskMarkdown()
  mirror/writer.ts        -- mirrorTask()
  seed.ts                 -- 演示场景 + 镜像; 兼作 CLI
tests/**                  -- 与 src 镜像的测试
```

---

### Task 1: 项目脚手架 + 数据库连接 + 类型枚举

**Files:**
- Create: `package.json`, `tsconfig.json`, `vitest.config.ts`, `.gitignore`
- Create: `src/util.ts`, `src/model/types.ts`, `src/db/schema.sql`, `src/db/connection.ts`
- Test: `tests/db/connection.test.ts`

**Interfaces:**
- Consumes: 无(首个任务)。
- Produces: `openDb(path?): DB`; 全部枚举与接口 `Actor/Task/Edge/TaskEvent`; `now()`, `uid(prefix)`。

- [ ] **Step 1: 写下配置文件**

`package.json`:
```json
{
  "name": "relay",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "scripts": {
    "test": "vitest run",
    "test:watch": "vitest",
    "seed": "tsx src/seed.ts"
  },
  "dependencies": {
    "better-sqlite3": "^11.8.0"
  },
  "devDependencies": {
    "@types/better-sqlite3": "^7.6.11",
    "@types/node": "^22.10.0",
    "tsx": "^4.19.0",
    "typescript": "^5.7.0",
    "vitest": "^2.1.0"
  }
}
```

`tsconfig.json`:
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "resolveJsonModule": true,
    "types": ["node"],
    "outDir": "dist"
  },
  "include": ["src", "tests"]
}
```

`vitest.config.ts`:
```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: { environment: 'node' },
});
```

`.gitignore`:
```
node_modules/
dist/
data/
*.db
*.db-wal
*.db-shm
```

- [ ] **Step 2: 写工具与类型**

`src/util.ts`:
```ts
import { randomUUID } from 'node:crypto';

export const now = (): string => new Date().toISOString();
export const uid = (prefix: string): string => `${prefix}_${randomUUID().slice(0, 8)}`;
```

`src/model/types.ts`:
```ts
export type ActorType = 'human' | 'agent';
export type Role = 'planner' | 'executor' | 'tester' | 'questioner' | 'decider';
export type TaskState =
  | 'planning' | 'awaiting_confirm' | 'executing'
  | 'awaiting_decision' | 'testing' | 'done';
export type EdgeType = 'blocks' | 'depends_on' | 'clarifies' | 'spawns';
export type EventKind = 'handoff' | 'comment' | 'output' | 'clarify' | 'decide' | 'claim';
export type Priority = 'hi' | 'mid' | 'lo';

export interface Actor {
  id: string;
  name: string;
  type: ActorType;
  handle: string | null;
  createdAt: string;
}

export interface Task {
  id: string;
  title: string;
  parentId: string | null;
  state: TaskState;
  currentActor: string | null;
  currentRole: Role | null;
  goal: string | null;
  inputsMd: string | null;
  outputsMd: string | null;
  summary: string | null;
  priority: Priority | null;
  createdAt: string;
  updatedAt: string;
}

export interface Edge {
  id: string;
  fromTask: string;
  toTask: string;
  type: EdgeType;
  createdAt: string;
}

export interface TaskEvent {
  id: string;
  taskId: string;
  actorId: string;
  kind: EventKind;
  roleFrom: Role | null;
  roleTo: Role | null;
  body: string | null;
  createdAt: string;
}
```

- [ ] **Step 3: 写 schema 与连接**

`src/db/schema.sql`:
```sql
CREATE TABLE IF NOT EXISTS actors (
  id         TEXT PRIMARY KEY,
  name       TEXT NOT NULL,
  type       TEXT NOT NULL CHECK (type IN ('human','agent')),
  handle     TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS tasks (
  id            TEXT PRIMARY KEY,
  title         TEXT NOT NULL,
  parent_id     TEXT REFERENCES tasks(id),
  state         TEXT NOT NULL CHECK (state IN
                  ('planning','awaiting_confirm','executing','awaiting_decision','testing','done')),
  current_actor TEXT REFERENCES actors(id),
  current_role  TEXT CHECK (current_role IN ('planner','executor','tester','questioner','decider')),
  goal          TEXT,
  inputs_md     TEXT,
  outputs_md    TEXT,
  summary       TEXT,
  priority      TEXT CHECK (priority IN ('hi','mid','lo')),
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS edges (
  id         TEXT PRIMARY KEY,
  from_task  TEXT NOT NULL REFERENCES tasks(id),
  to_task    TEXT NOT NULL REFERENCES tasks(id),
  type       TEXT NOT NULL CHECK (type IN ('blocks','depends_on','clarifies','spawns')),
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS events (
  id         TEXT PRIMARY KEY,
  task_id    TEXT NOT NULL REFERENCES tasks(id),
  actor_id   TEXT NOT NULL REFERENCES actors(id),
  kind       TEXT NOT NULL CHECK (kind IN ('handoff','comment','output','clarify','decide','claim')),
  role_from  TEXT,
  role_to    TEXT,
  body       TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_tasks_parent ON tasks(parent_id);
CREATE INDEX IF NOT EXISTS idx_tasks_state  ON tasks(state);
CREATE INDEX IF NOT EXISTS idx_edges_from   ON edges(from_task);
CREATE INDEX IF NOT EXISTS idx_edges_to     ON edges(to_task);
CREATE INDEX IF NOT EXISTS idx_events_task  ON events(task_id);
```

`src/db/connection.ts`:
```ts
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
  return db;
}
```

- [ ] **Step 4: 写失败测试**

`tests/db/connection.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
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
});
```

- [ ] **Step 5: 安装依赖并跑测试**

Run: `npm install && npm test`
Expected: `connection.test.ts` PASS(1 passed)。

- [ ] **Step 6: 提交**

```bash
git add package.json tsconfig.json vitest.config.ts .gitignore src tests
git commit -m "🧱 脚手架 + SQLite 连接与四表 schema + 核心类型"
```

---

### Task 2: Actor 仓库(人/agent 同表)

**Files:**
- Create: `src/repo/actors.ts`
- Test: `tests/repo/actors.test.ts`

**Interfaces:**
- Consumes: `DB`(Task 1); `Actor`, `ActorType`(Task 1); `now()`(Task 1)。
- Produces:
  - `createActor(db, { id: string; name: string; type: ActorType; handle?: string | null }): Actor`
  - `getActor(db, id: string): Actor | null`
  - `listActors(db, type?: ActorType): Actor[]`

- [ ] **Step 1: 写失败测试**

`tests/repo/actors.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { openDb } from '../../src/db/connection';
import { createActor, getActor, listActors } from '../../src/repo/actors';

describe('actors repo', () => {
  it('创建人和 agent, 可取回、可按类型列出', () => {
    const db = openDb(':memory:');
    createActor(db, { id: 'you', name: '你', type: 'human' });
    createActor(db, { id: 'agent-exec-a', name: '执行·A', type: 'agent', handle: 'mcp:exec-a' });

    const you = getActor(db, 'you');
    expect(you?.name).toBe('你');
    expect(you?.type).toBe('human');
    expect(you?.handle).toBeNull();

    expect(getActor(db, 'agent-exec-a')?.handle).toBe('mcp:exec-a');
    expect(listActors(db).length).toBe(2);
    expect(listActors(db, 'agent').map((a) => a.id)).toEqual(['agent-exec-a']);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run tests/repo/actors.test.ts`
Expected: FAIL(找不到模块 `../../src/repo/actors`)。

- [ ] **Step 3: 实现**

`src/repo/actors.ts`:
```ts
import type { DB } from '../db/connection';
import type { Actor, ActorType } from '../model/types';
import { now } from '../util';

interface ActorRow {
  id: string; name: string; type: ActorType; handle: string | null; created_at: string;
}
const map = (r: ActorRow): Actor => ({
  id: r.id, name: r.name, type: r.type, handle: r.handle, createdAt: r.created_at,
});

export function createActor(
  db: DB,
  input: { id: string; name: string; type: ActorType; handle?: string | null },
): Actor {
  const row: ActorRow = {
    id: input.id, name: input.name, type: input.type,
    handle: input.handle ?? null, created_at: now(),
  };
  db.prepare('INSERT INTO actors (id,name,type,handle,created_at) VALUES (?,?,?,?,?)')
    .run(row.id, row.name, row.type, row.handle, row.created_at);
  return map(row);
}

export function getActor(db: DB, id: string): Actor | null {
  const r = db.prepare('SELECT * FROM actors WHERE id=?').get(id) as ActorRow | undefined;
  return r ? map(r) : null;
}

export function listActors(db: DB, type?: ActorType): Actor[] {
  const rows = (type
    ? db.prepare('SELECT * FROM actors WHERE type=? ORDER BY id').all(type)
    : db.prepare('SELECT * FROM actors ORDER BY id').all()) as ActorRow[];
  return rows.map(map);
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npx vitest run tests/repo/actors.test.ts`
Expected: PASS(1 passed)。

- [ ] **Step 5: 提交**

```bash
git add src/repo/actors.ts tests/repo/actors.test.ts
git commit -m "👥 Actor 仓库:人与 agent 同表, 按类型查询"
```

---

### Task 3: Task 仓库(含递归查询)

**Files:**
- Create: `src/repo/tasks.ts`
- Test: `tests/repo/tasks.test.ts`

**Interfaces:**
- Consumes: `DB`; `Task`, `TaskState`, `Role`, `Priority`; `now()`。
- Produces:
  - `nextTaskId(db): string`
  - `CreateTaskInput`(见实现); `createTask(db, input: CreateTaskInput): Task`
  - `getTask(db, id): Task | null`
  - `TaskPatch`(见实现); `updateTask(db, id, patch: TaskPatch): Task`
  - `listChildren(db, parentId): Task[]`
  - `listRoots(db): Task[]`
  - `ancestors(db, id): Task[]`(从最顶层祖先到直接父, 顺序排列)

- [ ] **Step 1: 写失败测试**

`tests/repo/tasks.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { openDb } from '../../src/db/connection';
import {
  createTask, getTask, updateTask, listChildren, listRoots, ancestors, nextTaskId,
} from '../../src/repo/tasks';

describe('tasks repo', () => {
  it('创建根/子任务, ID 递增, 支持递归查询', () => {
    const db = openDb(':memory:');
    const root = createTask(db, { title: '项目' });
    expect(root.id).toBe('R-1');
    expect(root.state).toBe('planning');

    const child = createTask(db, { title: '子任务', parentId: root.id });
    expect(child.id).toBe('R-2');
    expect(nextTaskId(db)).toBe('R-3');

    const grand = createTask(db, { title: '孙任务', parentId: child.id });

    expect(listRoots(db).map((t) => t.id)).toEqual(['R-1']);
    expect(listChildren(db, root.id).map((t) => t.id)).toEqual(['R-2']);
    expect(ancestors(db, grand.id).map((t) => t.id)).toEqual(['R-1', 'R-2']);
  });

  it('更新字段并推进 updated_at', () => {
    const db = openDb(':memory:');
    const t = createTask(db, { title: 'x' });
    const before = t.updatedAt;
    const u = updateTask(db, t.id, { state: 'executing', summary: '干起来了' });
    expect(u.state).toBe('executing');
    expect(u.summary).toBe('干起来了');
    expect(u.updatedAt >= before).toBe(true);
    expect(getTask(db, t.id)?.state).toBe('executing');
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run tests/repo/tasks.test.ts`
Expected: FAIL(找不到模块)。

- [ ] **Step 3: 实现**

`src/repo/tasks.ts`:
```ts
import type { DB } from '../db/connection';
import type { Task, TaskState, Role, Priority } from '../model/types';
import { now } from '../util';

interface TaskRow {
  id: string; title: string; parent_id: string | null; state: string;
  current_actor: string | null; current_role: string | null;
  goal: string | null; inputs_md: string | null; outputs_md: string | null;
  summary: string | null; priority: string | null; created_at: string; updated_at: string;
}
const map = (r: TaskRow): Task => ({
  id: r.id, title: r.title, parentId: r.parent_id, state: r.state as TaskState,
  currentActor: r.current_actor, currentRole: r.current_role as Role | null,
  goal: r.goal, inputsMd: r.inputs_md, outputsMd: r.outputs_md, summary: r.summary,
  priority: r.priority as Priority | null, createdAt: r.created_at, updatedAt: r.updated_at,
});

export function nextTaskId(db: DB): string {
  const rows = db.prepare("SELECT id FROM tasks WHERE id LIKE 'R-%'").all() as { id: string }[];
  const max = rows.reduce((m, { id }) => {
    const n = parseInt(id.slice(2), 10);
    return Number.isFinite(n) && n > m ? n : m;
  }, 0);
  return `R-${max + 1}`;
}

export interface CreateTaskInput {
  title: string; id?: string; parentId?: string | null; state?: TaskState;
  currentActor?: string | null; currentRole?: Role | null;
  goal?: string | null; inputsMd?: string | null; outputsMd?: string | null;
  summary?: string | null; priority?: Priority | null;
}

export function createTask(db: DB, input: CreateTaskInput): Task {
  const id = input.id ?? nextTaskId(db);
  const ts = now();
  const row: TaskRow = {
    id, title: input.title, parent_id: input.parentId ?? null, state: input.state ?? 'planning',
    current_actor: input.currentActor ?? null, current_role: input.currentRole ?? null,
    goal: input.goal ?? null, inputs_md: input.inputsMd ?? null, outputs_md: input.outputsMd ?? null,
    summary: input.summary ?? null, priority: input.priority ?? null, created_at: ts, updated_at: ts,
  };
  db.prepare(
    `INSERT INTO tasks
       (id,title,parent_id,state,current_actor,current_role,goal,inputs_md,outputs_md,summary,priority,created_at,updated_at)
     VALUES
       (@id,@title,@parent_id,@state,@current_actor,@current_role,@goal,@inputs_md,@outputs_md,@summary,@priority,@created_at,@updated_at)`,
  ).run(row);
  return map(row);
}

export function getTask(db: DB, id: string): Task | null {
  const r = db.prepare('SELECT * FROM tasks WHERE id=?').get(id) as TaskRow | undefined;
  return r ? map(r) : null;
}

export interface TaskPatch {
  title?: string; state?: TaskState; currentActor?: string | null; currentRole?: Role | null;
  goal?: string | null; inputsMd?: string | null; outputsMd?: string | null;
  summary?: string | null; priority?: Priority | null;
}

export function updateTask(db: DB, id: string, patch: TaskPatch): Task {
  if (!getTask(db, id)) throw new Error(`任务不存在: ${id}`);
  const cols: Record<string, keyof TaskPatch> = {
    title: 'title', state: 'state', current_actor: 'currentActor', current_role: 'currentRole',
    goal: 'goal', inputs_md: 'inputsMd', outputs_md: 'outputsMd', summary: 'summary', priority: 'priority',
  };
  const sets: string[] = [];
  const vals: unknown[] = [];
  for (const [col, key] of Object.entries(cols)) {
    if (key in patch) { sets.push(`${col}=?`); vals.push(patch[key] ?? null); }
  }
  sets.push('updated_at=?'); vals.push(now());
  vals.push(id);
  db.prepare(`UPDATE tasks SET ${sets.join(', ')} WHERE id=?`).run(...vals);
  return getTask(db, id)!;
}

export function listChildren(db: DB, parentId: string): Task[] {
  return (db.prepare('SELECT * FROM tasks WHERE parent_id=? ORDER BY id').all(parentId) as TaskRow[]).map(map);
}

export function listRoots(db: DB): Task[] {
  return (db.prepare('SELECT * FROM tasks WHERE parent_id IS NULL ORDER BY id').all() as TaskRow[]).map(map);
}

export function ancestors(db: DB, id: string): Task[] {
  const chain: Task[] = [];
  let cur = getTask(db, id);
  while (cur?.parentId) {
    const p = getTask(db, cur.parentId);
    if (!p) break;
    chain.unshift(p);
    cur = p;
  }
  return chain;
}
```

> 注意: `updateTask` 的 `id LIKE 'R-%'` 排序按数字后缀比较; 测试里 `R-1`/`R-2` 顺序稳定。`ancestors` 用 `unshift` 保证"顶层→直接父"顺序。

- [ ] **Step 4: 跑测试确认通过**

Run: `npx vitest run tests/repo/tasks.test.ts`
Expected: PASS(2 passed)。

- [ ] **Step 5: 提交**

```bash
git add src/repo/tasks.ts tests/repo/tasks.test.ts
git commit -m "🌳 Task 仓库:递归任务 CRUD + 祖先/子任务查询"
```

---

### Task 4: Edge 仓库(关系边)

**Files:**
- Create: `src/repo/edges.ts`
- Test: `tests/repo/edges.test.ts`

**Interfaces:**
- Consumes: `DB`; `Edge`, `EdgeType`; `now()`, `uid()`。
- Produces:
  - `createEdge(db, { fromTask: string; toTask: string; type: EdgeType }): Edge`
  - `edgesFrom(db, taskId): Edge[]`(按插入顺序)
  - `edgesTo(db, taskId): Edge[]`(按插入顺序)

- [ ] **Step 1: 写失败测试**

`tests/repo/edges.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { openDb } from '../../src/db/connection';
import { createTask } from '../../src/repo/tasks';
import { createEdge, edgesFrom, edgesTo } from '../../src/repo/edges';

describe('edges repo', () => {
  it('创建有向边, 可按 from/to 查询', () => {
    const db = openDb(':memory:');
    const a = createTask(db, { title: 'A' });
    const b = createTask(db, { title: 'B' });
    createEdge(db, { fromTask: a.id, toTask: b.id, type: 'depends_on' });

    const out = edgesFrom(db, a.id);
    expect(out.length).toBe(1);
    expect(out[0].type).toBe('depends_on');
    expect(out[0].toTask).toBe(b.id);

    const inb = edgesTo(db, b.id);
    expect(inb[0].fromTask).toBe(a.id);
    expect(edgesFrom(db, b.id)).toEqual([]);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run tests/repo/edges.test.ts`
Expected: FAIL(找不到模块)。

- [ ] **Step 3: 实现**

`src/repo/edges.ts`:
```ts
import type { DB } from '../db/connection';
import type { Edge, EdgeType } from '../model/types';
import { now, uid } from '../util';

interface EdgeRow {
  id: string; from_task: string; to_task: string; type: EdgeType; created_at: string;
}
const map = (r: EdgeRow): Edge => ({
  id: r.id, fromTask: r.from_task, toTask: r.to_task, type: r.type, createdAt: r.created_at,
});

export function createEdge(
  db: DB,
  input: { fromTask: string; toTask: string; type: EdgeType },
): Edge {
  const row: EdgeRow = {
    id: uid('e'), from_task: input.fromTask, to_task: input.toTask,
    type: input.type, created_at: now(),
  };
  db.prepare('INSERT INTO edges (id,from_task,to_task,type,created_at) VALUES (?,?,?,?,?)')
    .run(row.id, row.from_task, row.to_task, row.type, row.created_at);
  return map(row);
}

export function edgesFrom(db: DB, taskId: string): Edge[] {
  return (db.prepare('SELECT * FROM edges WHERE from_task=? ORDER BY rowid').all(taskId) as EdgeRow[]).map(map);
}

export function edgesTo(db: DB, taskId: string): Edge[] {
  return (db.prepare('SELECT * FROM edges WHERE to_task=? ORDER BY rowid').all(taskId) as EdgeRow[]).map(map);
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npx vitest run tests/repo/edges.test.ts`
Expected: PASS(1 passed)。

- [ ] **Step 5: 提交**

```bash
git add src/repo/edges.ts tests/repo/edges.test.ts
git commit -m "🔗 Edge 仓库:有向关系边, from/to 查询"
```

---

### Task 5: Event 仓库(交互记录 Thread)

**Files:**
- Create: `src/repo/events.ts`
- Test: `tests/repo/events.test.ts`

**Interfaces:**
- Consumes: `DB`; `TaskEvent`, `EventKind`, `Role`; `now()`, `uid()`。
- Produces:
  - `appendEvent(db, { taskId; actorId; kind: EventKind; roleFrom?: Role|null; roleTo?: Role|null; body?: string|null }): TaskEvent`
  - `listEvents(db, taskId): TaskEvent[]`(严格按插入顺序, `ORDER BY rowid`)

- [ ] **Step 1: 写失败测试**

`tests/repo/events.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { openDb } from '../../src/db/connection';
import { createTask } from '../../src/repo/tasks';
import { createActor } from '../../src/repo/actors';
import { appendEvent, listEvents } from '../../src/repo/events';

describe('events repo', () => {
  it('追加事件并按插入顺序返回', () => {
    const db = openDb(':memory:');
    createActor(db, { id: 'you', name: '你', type: 'human' });
    const t = createTask(db, { title: 'T' });

    appendEvent(db, { taskId: t.id, actorId: 'you', kind: 'claim' });
    appendEvent(db, {
      taskId: t.id, actorId: 'you', kind: 'handoff',
      roleFrom: 'planner', roleTo: 'executor', body: '交给执行者',
    });

    const evs = listEvents(db, t.id);
    expect(evs.map((e) => e.kind)).toEqual(['claim', 'handoff']);
    expect(evs[1].roleFrom).toBe('planner');
    expect(evs[1].roleTo).toBe('executor');
    expect(evs[1].body).toBe('交给执行者');
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run tests/repo/events.test.ts`
Expected: FAIL(找不到模块)。

- [ ] **Step 3: 实现**

`src/repo/events.ts`:
```ts
import type { DB } from '../db/connection';
import type { TaskEvent, EventKind, Role } from '../model/types';
import { now, uid } from '../util';

interface EventRow {
  id: string; task_id: string; actor_id: string; kind: EventKind;
  role_from: string | null; role_to: string | null; body: string | null; created_at: string;
}
const map = (r: EventRow): TaskEvent => ({
  id: r.id, taskId: r.task_id, actorId: r.actor_id, kind: r.kind,
  roleFrom: r.role_from as Role | null, roleTo: r.role_to as Role | null,
  body: r.body, createdAt: r.created_at,
});

export function appendEvent(
  db: DB,
  input: {
    taskId: string; actorId: string; kind: EventKind;
    roleFrom?: Role | null; roleTo?: Role | null; body?: string | null;
  },
): TaskEvent {
  const row: EventRow = {
    id: uid('ev'), task_id: input.taskId, actor_id: input.actorId, kind: input.kind,
    role_from: input.roleFrom ?? null, role_to: input.roleTo ?? null,
    body: input.body ?? null, created_at: now(),
  };
  db.prepare(
    'INSERT INTO events (id,task_id,actor_id,kind,role_from,role_to,body,created_at) VALUES (?,?,?,?,?,?,?,?)',
  ).run(row.id, row.task_id, row.actor_id, row.kind, row.role_from, row.role_to, row.body, row.created_at);
  return map(row);
}

export function listEvents(db: DB, taskId: string): TaskEvent[] {
  return (db.prepare('SELECT * FROM events WHERE task_id=? ORDER BY rowid').all(taskId) as EventRow[]).map(map);
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npx vitest run tests/repo/events.test.ts`
Expected: PASS(1 passed)。

- [ ] **Step 5: 提交**

```bash
git add src/repo/events.ts tests/repo/events.test.ts
git commit -m "📜 Event 仓库:append-only 交互记录, 严格插入序"
```

---

### Task 6: 状态机 + 默认路由

**Files:**
- Create: `src/core/stateMachine.ts`
- Test: `tests/core/stateMachine.test.ts`

**Interfaces:**
- Consumes: `TaskState`, `Role`。
- Produces:
  - `TRANSITIONS: Record<TaskState, TaskState[]>`
  - `canTransition(from: TaskState, to: TaskState): boolean`(同态视为合法)
  - `defaultNext(state: TaskState): { state: TaskState; role: Role } | null`

- [ ] **Step 1: 写失败测试**

`tests/core/stateMachine.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { canTransition, defaultNext } from '../../src/core/stateMachine';

describe('stateMachine', () => {
  it('允许合法流转, 拒绝跳跃与终态外流', () => {
    expect(canTransition('executing', 'testing')).toBe(true);
    expect(canTransition('executing', 'awaiting_decision')).toBe(true);
    expect(canTransition('executing', 'done')).toBe(false);
    expect(canTransition('done', 'executing')).toBe(false);
    expect(canTransition('executing', 'executing')).toBe(true); // 同态
  });

  it('默认路由建议下一步', () => {
    expect(defaultNext('executing')).toEqual({ state: 'testing', role: 'tester' });
    expect(defaultNext('awaiting_decision')).toEqual({ state: 'executing', role: 'executor' });
    expect(defaultNext('done')).toBeNull();
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run tests/core/stateMachine.test.ts`
Expected: FAIL(找不到模块)。

- [ ] **Step 3: 实现**

`src/core/stateMachine.ts`:
```ts
import type { TaskState, Role } from '../model/types';

export const TRANSITIONS: Record<TaskState, TaskState[]> = {
  planning: ['awaiting_confirm', 'executing'],
  awaiting_confirm: ['executing', 'planning'],
  executing: ['awaiting_decision', 'testing'],
  awaiting_decision: ['executing'],
  testing: ['done', 'executing'],
  done: [],
};

export function canTransition(from: TaskState, to: TaskState): boolean {
  return from === to || TRANSITIONS[from].includes(to);
}

const DEFAULT_NEXT: Record<TaskState, { state: TaskState; role: Role } | null> = {
  planning: { state: 'awaiting_confirm', role: 'decider' },
  awaiting_confirm: { state: 'executing', role: 'executor' },
  executing: { state: 'testing', role: 'tester' },
  awaiting_decision: { state: 'executing', role: 'executor' },
  testing: { state: 'done', role: 'tester' },
  done: null,
};

export function defaultNext(state: TaskState): { state: TaskState; role: Role } | null {
  return DEFAULT_NEXT[state];
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npx vitest run tests/core/stateMachine.test.ts`
Expected: PASS(2 passed)。

- [ ] **Step 5: 提交**

```bash
git add src/core/stateMachine.ts tests/core/stateMachine.test.ts
git commit -m "🔀 状态机:六态固定骨架 + 默认路由建议"
```

---

### Task 7: 换手操作 Handoff

**Files:**
- Create: `src/core/handoff.ts`
- Test: `tests/core/handoff.test.ts`

**Interfaces:**
- Consumes: `DB`; `Task`, `Role`, `TaskState`; `getTask`, `updateTask`(Task 3); `appendEvent`(Task 5); `canTransition`(Task 6)。
- Produces:
  - `HandoffInput = { taskId; byActor; toActor; toRole: Role; toState?: TaskState; note?: string }`
  - `handoff(db, input: HandoffInput): Task`(改 current_actor/current_role/state + 追加 handoff 事件; 非法流转抛错)

- [ ] **Step 1: 写失败测试**

`tests/core/handoff.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { openDb } from '../../src/db/connection';
import { createActor } from '../../src/repo/actors';
import { createTask, getTask } from '../../src/repo/tasks';
import { listEvents } from '../../src/repo/events';
import { handoff } from '../../src/core/handoff';

describe('handoff', () => {
  it('换手改变负责人/角色/状态, 并留下换手记录', () => {
    const db = openDb(':memory:');
    createActor(db, { id: 'exec', name: '执行·A', type: 'agent' });
    createActor(db, { id: 'test', name: '测试·T', type: 'agent' });
    const t = createTask(db, {
      title: '搭建数据层', state: 'executing',
      currentActor: 'exec', currentRole: 'executor', outputsMd: '产物: schema.sql',
    });

    const after = handoff(db, {
      taskId: t.id, byActor: 'exec', toActor: 'test', toRole: 'tester', toState: 'testing', note: '交付验收',
    });

    expect(after.currentActor).toBe('test');
    expect(after.currentRole).toBe('tester');
    expect(after.state).toBe('testing');
    // 上一棒的产出原样保留 —— 成为测试者的输入
    expect(after.outputsMd).toBe('产物: schema.sql');

    const ev = listEvents(db, t.id).at(-1)!;
    expect(ev.kind).toBe('handoff');
    expect(ev.roleFrom).toBe('executor');
    expect(ev.roleTo).toBe('tester');
  });

  it('拒绝非法状态流转', () => {
    const db = openDb(':memory:');
    createActor(db, { id: 'exec', name: 'A', type: 'agent' });
    const t = createTask(db, { title: 'x', state: 'executing', currentActor: 'exec', currentRole: 'executor' });
    expect(() => handoff(db, {
      taskId: t.id, byActor: 'exec', toActor: 'exec', toRole: 'tester', toState: 'done',
    })).toThrow(/非法状态流转/);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run tests/core/handoff.test.ts`
Expected: FAIL(找不到模块)。

- [ ] **Step 3: 实现**

`src/core/handoff.ts`:
```ts
import type { DB } from '../db/connection';
import type { Task, Role, TaskState } from '../model/types';
import { getTask, updateTask } from '../repo/tasks';
import { appendEvent } from '../repo/events';
import { canTransition } from './stateMachine';

export interface HandoffInput {
  taskId: string;
  byActor: string;
  toActor: string;
  toRole: Role;
  toState?: TaskState;
  note?: string;
}

export function handoff(db: DB, input: HandoffInput): Task {
  const task = getTask(db, input.taskId);
  if (!task) throw new Error(`任务不存在: ${input.taskId}`);
  const toState = input.toState ?? task.state;
  if (!canTransition(task.state, toState)) {
    throw new Error(`非法状态流转: ${task.state} → ${toState}`);
  }
  const fromRole = task.currentRole;
  const updated = updateTask(db, input.taskId, {
    currentActor: input.toActor, currentRole: input.toRole, state: toState,
  });
  appendEvent(db, {
    taskId: input.taskId, actorId: input.byActor, kind: 'handoff',
    roleFrom: fromRole, roleTo: input.toRole, body: input.note ?? null,
  });
  return updated;
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npx vitest run tests/core/handoff.test.ts`
Expected: PASS(2 passed)。

- [ ] **Step 5: 提交**

```bash
git add src/core/handoff.ts tests/core/handoff.test.ts
git commit -m "🤝 换手操作:改负责人/角色/状态 + 记录, 校验合法流转"
```

---

### Task 8: 待确认闭环(raise / answer)

**Files:**
- Create: `src/core/clarification.ts`
- Test: `tests/core/clarification.test.ts`

**Interfaces:**
- Consumes: `DB`; `Task`; `getTask`, `updateTask`, `createTask`(Task 3); `createEdge`(Task 4); `appendEvent`(Task 5)。
- Produces:
  - `raiseClarification(db, { parentId; byActor; question; options?: string[]; toDecider?: string }): { clarTask: Task; parent: Task }`
    - 新建子任务(goal=问题, state=`awaiting_decision`, role=`decider`) + `clarifies` 边(子→父) + `spawns` 边(父→子); 父任务转 `awaiting_decision` 并留 `clarify` 事件。
  - `answerClarification(db, { clarTaskId; byActor; answer }): { clarTask: Task; parent: Task }`
    - 答案写入澄清任务 outputs/summary 并置 `done`; 父任务转回 `executing`; 双方各留 `decide` 事件。

- [ ] **Step 1: 写失败测试**

`tests/core/clarification.test.ts`:
```ts
import { describe, it, expect } from 'vitest';
import { openDb } from '../../src/db/connection';
import { createActor } from '../../src/repo/actors';
import { createTask, getTask } from '../../src/repo/tasks';
import { edgesFrom, edgesTo } from '../../src/repo/edges';
import { listEvents } from '../../src/repo/events';
import { raiseClarification, answerClarification } from '../../src/core/clarification';

describe('待确认闭环', () => {
  it('执行者卡住 → 触发待确认 → 父任务挂起', () => {
    const db = openDb(':memory:');
    createActor(db, { id: 'exec', name: '执行·A', type: 'agent' });
    createActor(db, { id: 'you', name: '你', type: 'human' });
    const parent = createTask(db, {
      title: '搭建数据层', state: 'executing', currentActor: 'exec', currentRole: 'executor',
    });

    const { clarTask } = raiseClarification(db, {
      parentId: parent.id, byActor: 'exec',
      question: '信息包是否允许附件?', options: ['纯 Markdown', '结构化 JSON'], toDecider: 'you',
    });

    expect(getTask(db, parent.id)!.state).toBe('awaiting_decision'); // 父挂起
    expect(clarTask.parentId).toBe(parent.id);
    expect(clarTask.state).toBe('awaiting_decision');
    expect(clarTask.currentRole).toBe('decider');
    expect(clarTask.goal).toContain('信息包是否允许附件?');
    expect(clarTask.goal).toContain('纯 Markdown'); // 选项进了 goal

    // 边: 子 --clarifies--> 父, 父 --spawns--> 子
    expect(edgesFrom(db, clarTask.id).some((e) => e.type === 'clarifies' && e.toTask === parent.id)).toBe(true);
    expect(edgesTo(db, clarTask.id).some((e) => e.type === 'spawns' && e.fromTask === parent.id)).toBe(true);
    expect(listEvents(db, parent.id).at(-1)!.kind).toBe('clarify');
  });

  it('决策者答复 → 答案回流 → 父任务解冻续跑', () => {
    const db = openDb(':memory:');
    createActor(db, { id: 'exec', name: '执行·A', type: 'agent' });
    createActor(db, { id: 'you', name: '你', type: 'human' });
    const parent = createTask(db, {
      title: '搭建数据层', state: 'executing', currentActor: 'exec', currentRole: 'executor',
    });
    const { clarTask } = raiseClarification(db, {
      parentId: parent.id, byActor: 'exec', question: '附件?', toDecider: 'you',
    });

    const { clarTask: closed, parent: resumed } = answerClarification(db, {
      clarTaskId: clarTask.id, byActor: 'you', answer: '方案 A: 纯 Markdown + 外链',
    });

    expect(closed.state).toBe('done');
    expect(closed.outputsMd).toBe('方案 A: 纯 Markdown + 外链');
    expect(resumed.state).toBe('executing'); // 父解冻
    expect(listEvents(db, parent.id).at(-1)!.kind).toBe('decide');
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run tests/core/clarification.test.ts`
Expected: FAIL(找不到模块)。

- [ ] **Step 3: 实现**

`src/core/clarification.ts`:
```ts
import type { DB } from '../db/connection';
import type { Task } from '../model/types';
import { getTask, updateTask, createTask } from '../repo/tasks';
import { createEdge } from '../repo/edges';
import { appendEvent } from '../repo/events';

export interface RaiseInput {
  parentId: string;
  byActor: string;
  question: string;
  options?: string[];
  toDecider?: string;
}

export function raiseClarification(
  db: DB,
  input: RaiseInput,
): { clarTask: Task; parent: Task } {
  const parent = getTask(db, input.parentId);
  if (!parent) throw new Error(`任务不存在: ${input.parentId}`);

  const optionsMd = input.options?.length
    ? '\n\n可选项:\n' + input.options.map((o, i) => `- ${String.fromCharCode(65 + i)}. ${o}`).join('\n')
    : '';

  const clarTask = createTask(db, {
    title: `待确认: ${input.question}`,
    parentId: input.parentId,
    state: 'awaiting_decision',
    currentActor: input.toDecider ?? null,
    currentRole: 'decider',
    goal: input.question + optionsMd,
    priority: parent.priority,
  });

  createEdge(db, { fromTask: clarTask.id, toTask: input.parentId, type: 'clarifies' });
  createEdge(db, { fromTask: input.parentId, toTask: clarTask.id, type: 'spawns' });

  const parentUpdated = updateTask(db, input.parentId, { state: 'awaiting_decision' });
  appendEvent(db, {
    taskId: input.parentId, actorId: input.byActor, kind: 'clarify',
    roleFrom: parent.currentRole, roleTo: 'decider', body: input.question,
  });

  return { clarTask, parent: parentUpdated };
}

export interface AnswerInput {
  clarTaskId: string;
  byActor: string;
  answer: string;
}

export function answerClarification(
  db: DB,
  input: AnswerInput,
): { clarTask: Task; parent: Task } {
  const clar = getTask(db, input.clarTaskId);
  if (!clar) throw new Error(`待确认任务不存在: ${input.clarTaskId}`);

  const edge = db.prepare(
    "SELECT to_task FROM edges WHERE from_task=? AND type='clarifies'",
  ).get(input.clarTaskId) as { to_task: string } | undefined;
  if (!edge) throw new Error(`该任务不是待确认任务: ${input.clarTaskId}`);

  const clarTask = updateTask(db, input.clarTaskId, {
    outputsMd: input.answer, summary: input.answer, state: 'done',
  });
  appendEvent(db, { taskId: input.clarTaskId, actorId: input.byActor, kind: 'decide', body: input.answer });

  const parent = updateTask(db, edge.to_task, { state: 'executing' });
  appendEvent(db, {
    taskId: edge.to_task, actorId: input.byActor, kind: 'decide',
    roleTo: parent.currentRole, body: `已决策 ${input.clarTaskId}: ${input.answer}`,
  });

  return { clarTask, parent };
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npx vitest run tests/core/clarification.test.ts`
Expected: PASS(2 passed)。

- [ ] **Step 5: 提交**

```bash
git add src/core/clarification.ts tests/core/clarification.test.ts
git commit -m "⏸️ 待确认闭环:触发挂起父任务, 答复回流解冻(纯 task+edge)"
```

---

### Task 9: 信息包组装 assemblePackage

**Files:**
- Create: `src/core/infoPackage.ts`
- Test: `tests/core/infoPackage.test.ts`

**Interfaces:**
- Consumes: `DB`; `Task`, `Edge`, `TaskEvent`; `getTask`, `listChildren`, `ancestors`(Task 3); `edgesFrom`, `edgesTo`(Task 4); `listEvents`(Task 5)。
- Produces:
  - `DepOutput = { taskId; title; summary: string|null; outputsMd: string|null }`
  - `TaskPackage`(见实现: task/breadcrumb/inputs/outputs/clarifications/thread/subtasks/edges)
  - `assemblePackage(db, id): TaskPackage`

- [ ] **Step 1: 写失败测试**

`tests/core/infoPackage.test.ts`:
```ts
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
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run tests/core/infoPackage.test.ts`
Expected: FAIL(找不到模块)。

- [ ] **Step 3: 实现**

`src/core/infoPackage.ts`:
```ts
import type { DB } from '../db/connection';
import type { Task, Edge, TaskEvent } from '../model/types';
import { getTask, listChildren, ancestors } from '../repo/tasks';
import { edgesFrom, edgesTo } from '../repo/edges';
import { listEvents } from '../repo/events';

export interface DepOutput {
  taskId: string;
  title: string;
  summary: string | null;
  outputsMd: string | null;
}

export interface TaskPackage {
  task: Task;
  breadcrumb: Task[];
  inputs: { goal: string | null; inputsMd: string | null; depOutputs: DepOutput[] };
  outputs: { outputsMd: string | null; summary: string | null };
  clarifications: Task[];
  thread: TaskEvent[];
  subtasks: Task[];
  edges: { out: Edge[]; in: Edge[] };
}

export function assemblePackage(db: DB, id: string): TaskPackage {
  const task = getTask(db, id);
  if (!task) throw new Error(`任务不存在: ${id}`);

  const out = edgesFrom(db, id);
  const incoming = edgesTo(db, id);

  const depOutputs: DepOutput[] = out
    .filter((e) => e.type === 'depends_on')
    .map((e) => {
      const dep = getTask(db, e.toTask);
      return {
        taskId: e.toTask,
        title: dep?.title ?? e.toTask,
        summary: dep?.summary ?? null,
        outputsMd: dep?.outputsMd ?? null,
      };
    });

  const clarifications = incoming
    .filter((e) => e.type === 'clarifies')
    .map((e) => getTask(db, e.fromTask))
    .filter((t): t is Task => t !== null);

  return {
    task,
    breadcrumb: ancestors(db, id),
    inputs: { goal: task.goal, inputsMd: task.inputsMd, depOutputs },
    outputs: { outputsMd: task.outputsMd, summary: task.summary },
    clarifications,
    thread: listEvents(db, id),
    subtasks: listChildren(db, id),
    edges: { out, in: incoming },
  };
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npx vitest run tests/core/infoPackage.test.ts`
Expected: PASS(1 passed)。

- [ ] **Step 5: 提交**

```bash
git add src/core/infoPackage.ts tests/core/infoPackage.test.ts
git commit -m "📦 信息包组装:四槽位 + 面包屑 + 依赖产出 + 待确认(get_task 契约)"
```

---

### Task 10: 文件镜像(DB → Markdown)

**Files:**
- Create: `src/mirror/markdown.ts`, `src/mirror/writer.ts`
- Test: `tests/mirror/mirror.test.ts`

**Interfaces:**
- Consumes: `DB`; `TaskPackage`, `assemblePackage`(Task 9)。
- Produces:
  - `renderTaskMarkdown(pkg: TaskPackage): string`(frontmatter + 四槽位 + 子任务 + 边)
  - `mirrorTask(db: DB, dir: string, id: string): string`(写 `<dir>/<id>.md`, 返回路径)

- [ ] **Step 1: 写失败测试**

`tests/mirror/mirror.test.ts`:
```ts
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
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run tests/mirror/mirror.test.ts`
Expected: FAIL(找不到模块)。

- [ ] **Step 3: 实现**

`src/mirror/markdown.ts`:
```ts
import type { TaskPackage } from '../core/infoPackage';

export function renderTaskMarkdown(pkg: TaskPackage): string {
  const t = pkg.task;
  const lines: string[] = [
    '---',
    `id: ${t.id}`,
    `title: ${JSON.stringify(t.title)}`,
    `state: ${t.state}`,
    `role: ${t.currentRole ?? ''}`,
    `actor: ${t.currentActor ?? ''}`,
    `parent: ${t.parentId ?? ''}`,
    `priority: ${t.priority ?? ''}`,
    `updated_at: ${t.updatedAt}`,
    '---',
    '',
    `# ${t.title}`,
    '',
    '## 输入 Inputs',
    '',
  ];

  if (t.goal) lines.push(`**目标:** ${t.goal}`, '');
  if (t.inputsMd) lines.push(t.inputsMd, '');
  if (pkg.inputs.depOutputs.length) {
    lines.push('**依赖产出:**');
    for (const d of pkg.inputs.depOutputs) {
      lines.push(`- ${d.taskId} ${d.title}: ${d.summary ?? '(无摘要)'}`);
    }
    lines.push('');
  }

  lines.push('## 产出 Outputs', '');
  if (t.outputsMd) lines.push(t.outputsMd, '');
  if (t.summary) lines.push(`**摘要:** ${t.summary}`, '');

  if (pkg.clarifications.length) {
    lines.push('## 待确认 Clarification', '');
    for (const c of pkg.clarifications) {
      lines.push(`- [${c.state === 'done' ? 'x' : ' '}] ${c.id} ${c.title}`);
    }
    lines.push('');
  }

  if (pkg.subtasks.length) {
    lines.push('## 子任务 Subtasks', '');
    for (const s of pkg.subtasks) {
      lines.push(`- [${s.state === 'done' ? 'x' : ' '}] ${s.id} ${s.title}`);
    }
    lines.push('');
  }

  if (pkg.edges.out.length || pkg.edges.in.length) {
    lines.push('## 关系边 Edges', '');
    for (const e of pkg.edges.out) lines.push(`- ${e.type} → ${e.toTask}`);
    for (const e of pkg.edges.in) lines.push(`- ${e.fromTask} → ${e.type} → (本任务)`);
    lines.push('');
  }

  lines.push('## 交互记录 Thread', '');
  for (const ev of pkg.thread) {
    const route = ev.roleFrom || ev.roleTo ? ` (${ev.roleFrom ?? '?'} → ${ev.roleTo ?? '?'})` : '';
    lines.push(`- ${ev.createdAt} · ${ev.actorId} · ${ev.kind}${route}${ev.body ? ': ' + ev.body : ''}`);
  }
  lines.push('');

  return lines.join('\n');
}
```

`src/mirror/writer.ts`:
```ts
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { DB } from '../db/connection';
import { assemblePackage } from '../core/infoPackage';
import { renderTaskMarkdown } from './markdown';

export function mirrorTask(db: DB, dir: string, id: string): string {
  mkdirSync(dir, { recursive: true });
  const md = renderTaskMarkdown(assemblePackage(db, id));
  const path = join(dir, `${id}.md`);
  writeFileSync(path, md, 'utf8');
  return path;
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npx vitest run tests/mirror/mirror.test.ts`
Expected: PASS(2 passed)。

- [ ] **Step 5: 提交**

```bash
git add src/mirror tests/mirror
git commit -m "🪞 文件镜像:任务渲染为 Markdown(frontmatter+四槽位), 单向落盘"
```

---

### Task 11: Demo seed 脚本 + 端到端冒烟

**Files:**
- Create: `src/seed.ts`
- Test: `tests/seed.test.ts`

**Interfaces:**
- Consumes: `openDb`; `createActor`; `createTask`, `listRoots`(不直接用但保留), `getTask`; `createEdge`; `raiseClarification`; `mirrorTask`。
- Produces: `seed(db: DB, dir: string): { taskCount: number; files: string[] }`; 兼作 CLI(`npm run seed`)。

- [ ] **Step 1: 写失败测试**

`tests/seed.test.ts`:
```ts
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
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run tests/seed.test.ts`
Expected: FAIL(找不到模块 `../src/seed`)。

- [ ] **Step 3: 实现**

`src/seed.ts`:
```ts
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

// CLI: npm run seed → 落到 data/relay.db 并镜像到 tasks/
if (import.meta.url === `file://${process.argv[1]}`) {
  const db = openDb('data/relay.db');
  const res = seed(db, 'tasks');
  console.log(`✅ seed 完成: ${res.taskCount} 个任务, 镜像 ${res.files.length} 个文件到 tasks/`);
}
```

> `data/` 已在 `.gitignore`; `tasks/` 目录不忽略——镜像文件可提交、可 diff(spec §4.1)。CLI 判定 `import.meta.url === file://<argv[1]>` 用于区分"被 import"与"被直接运行"。

- [ ] **Step 4: 跑测试确认通过**

Run: `npx vitest run tests/seed.test.ts`
Expected: PASS(1 passed)。

- [ ] **Step 5: 跑一遍全量 + 手动验收 CLI**

Run: `npm test`
Expected: 全部 PASS(11 个测试文件)。

Run: `npm run seed`
Expected: 打印 `✅ seed 完成: 7 个任务, 镜像 7 个文件到 tasks/`; `tasks/R-142.md` 存在且含"## 待确认 Clarification"与"## 交互记录 Thread"。

- [ ] **Step 6: 提交**

```bash
git add src/seed.ts tests/seed.test.ts
git commit -m "🌱 seed 脚本:端到端演示 Relay 场景 + 全量镜像, CLI 可跑"
```

---

## Self-Review(对照 spec)

**1. Spec 覆盖**
- §2 四概念(Actor/Role/Task/Edge) → Task 1(类型/schema) + Task 2/3/4/5(仓库) ✓
- §2.1 六态状态机 + 默认路由 → Task 6 ✓
- §2.2 表设计(含 CHECK 约束/索引) → Task 1 ✓
- §3.1 换手(改负责人/角色/状态 + 事件; 上一棒产出=下一棒输入) → Task 7 ✓
- §3.2 待确认闭环(纯 task+edge, 无补丁) → Task 8 ✓
- §3.3 四槽位 ⟷ 机制映射(assemblePackage 即 get_task 契约) → Task 9 ✓
- §4.1 SQLite 真相源 + WAL → Task 1; 单向文件镜像 → Task 10 ✓
- §6 已定小决策(仅 Markdown+外链, 无富文本) → 贯穿 mirror/seed ✓
- **不在本计划**(明确移交后续): §3.4 MCP server → 计划 2; §5 Web UI(看板/详情/树) → 计划 3。

**2. 占位扫描**: 无 TBD/TODO; 每个 code step 均为完整可运行代码。✓

**3. 类型一致性**: `Role`/`TaskState`/`EdgeType`/`EventKind` 全程与 Global Constraints 锁定值一致; 函数签名跨任务一致(`handoff`/`raiseClarification`/`answerClarification`/`assemblePackage`/`renderTaskMarkdown`/`mirrorTask`); repo 均 `snake_case`↔`camelCase` 映射。✓

## 后续计划(依赖本地基)

- **计划 2 · MCP 接入层**: 用 `@modelcontextprotocol/sdk` 把 core 操作暴露为工具(`list_my_tasks/get_task/claim/handoff/submit_output/raise_clarification/answer_clarification/comment`); 加"变更即镜像"门面。
- **计划 3 · Web UI**: Fastify 提供本地 Web + React 前端, 实现 mockup 的看板 / 任务详情 / 任务树。
