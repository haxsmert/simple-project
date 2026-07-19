import { mkdirSync, rmSync } from 'node:fs';
import { dirname } from 'node:path';
import { openDb, type DB } from './db/connection';
import { createActor } from './repo/actors';
import { createTask } from './repo/tasks';
import { createEdge } from './repo/edges';
import { appendEvent } from './repo/events';
import { raiseClarification } from './core/clarification';
import { mirrorTask } from './mirror/writer';

// Demo 数据 —— 目标是把产品讲清楚, 不是随便塞几条:
//  · 项目两态都有(执行中若干 + 已完结一个演示归档区); 任务四阶段每列都有内容
//  · 两个"轮到你"的挂起: 计划等你拍板(hold=confirm) + agent 卡住提问(hold=decision) → 待你处理 = 2
//  · 多 agent 且**真实扮演过各自角色**(默认路由是行为性推断: 没有这些历史就只能兜底瞎猜, 规则等于没有)
//  · 子任务(可钻入)、依赖边(可跳转)、优先级、产出与摘要
//  · 「经过」有故事: 换手事件记全"谁交给了谁 / 状态怎么变的"
export function seed(db: DB, dir: string): { taskCount: number; files: string[] } {
  const admin = createActor(db, { id: 'admin', name: 'admin', type: 'human' });
  const execA = createActor(db, { id: 'agent-exec-a', name: '执行·A', type: 'agent' });
  const execB = createActor(db, { id: 'agent-exec-b', name: '执行·B', type: 'agent' });
  const planP = createActor(db, { id: 'agent-plan-p', name: '规划·P', type: 'agent' });
  const testT = createActor(db, { id: 'agent-test-t', name: '测试·T', type: 'agent' });

  // 换手事件: 记全"谁交给了谁 / 状态怎么变" —— 少了这些,「经过」只能吐"交给了下一个人"这种废话
  const handoffEvent = (
    taskId: string, by: string, to: string, roleTo: 'planner' | 'executor' | 'tester' | 'decider',
    stateFrom: 'planning' | 'executing' | 'testing', stateTo: 'planning' | 'executing' | 'testing' | 'done',
    holds?: { from?: 'confirm' | null; to?: 'confirm' | null }, note?: string,
  ) => appendEvent(db, {
    taskId, actorId: by, kind: 'handoff', roleTo, toActor: to, stateFrom, stateTo,
    holdFrom: holds?.from ?? null, holdTo: holds?.to ?? null, body: note ?? null,
  });

  // ── 项目 1: Relay 平台化(主线) ──────────────────────────────────
  const p1 = createTask(db, {
    id: 'R-1', title: 'Relay 平台化', state: 'executing', currentActor: admin.id, currentRole: 'planner',
    priority: 'hi', goal: '把 Relay 从单机原型推到能给团队用。',
  });

  const t2 = createTask(db, {
    id: 'R-2', title: 'MCP 工具限流与并发控制', parentId: p1.id,
    state: 'executing', currentActor: execA.id, currentRole: 'executor', priority: 'hi',
    goal: '给 8 个 MCP 工具加限流与并发保护',
    planMd: '确认后的计划:\n- [x] 令牌桶\n- [ ] 每 actor 配额',
    outputsMd: '- src/mcp/limiter.ts (草稿)',
    summary: '令牌桶已通, 配额进行中',
  });
  createTask(db, { id: 'R-3', title: '令牌桶实现', parentId: t2.id, state: 'done', currentActor: execA.id, currentRole: 'executor' });
  createTask(db, { id: 'R-4', title: '每 actor 配额', parentId: t2.id, state: 'executing', currentActor: execA.id, currentRole: 'executor' });
  handoffEvent(t2.id, admin.id, execA.id, 'executor', 'planning', 'executing', { from: 'confirm', to: null }, '先按 actor 维度限流, 工具维度以后再说');
  appendEvent(db, { taskId: t2.id, actorId: admin.id, kind: 'comment', body: '配额按 actor 还是按工具? 先按 actor。' });

  createTask(db, {
    id: 'R-5', title: '看板拖拽换手交互', parentId: p1.id,
    state: 'testing', currentActor: testT.id, currentRole: 'tester', priority: 'mid',
    goal: '列内拖拽排序; 跨列不给拖 —— 状态归状态机管。',
    outputsMd: '- web/src/components/Board.tsx', summary: '排序算法已单测, 等人工验收',
  });
  handoffEvent('R-5', admin.id, testT.id, 'tester', 'executing', 'testing');

  createTask(db, {
    id: 'R-6', title: 'Web 端实时刷新', parentId: p1.id,
    state: 'planning', currentActor: planP.id, currentRole: 'planner', priority: 'lo',
    goal: 'agent 改了数据, 页面自己动, 不用手刷。',
  });

  // 轮到你 ①: agent 干活时卡住, 提问等你拍板 → 该任务自动挂起为待决策
  const t7 = createTask(db, {
    id: 'R-7', title: '导出任务为 Markdown 报告', parentId: p1.id,
    state: 'executing', currentActor: execB.id, currentRole: 'executor', priority: 'mid',
    goal: '一键导出某项目的所有任务',
  });
  raiseClarification(db, {
    parentId: t7.id, byActor: execB.id,
    question: '导出范围含已完成子任务吗?',
    options: ['含全部', '仅未完成'],
    toDecider: admin.id,
  });

  // ── 项目 2: MCP 生态接入 ───────────────────────────────────────
  // 项目只有「执行中/已完结」两态(2026-07-19 定调): 开了就在跑, 没有"待规划"阶段
  const p2 = createTask(db, {
    id: 'R-9', title: 'MCP 生态接入', state: 'executing', currentActor: admin.id, currentRole: 'planner',
    priority: 'mid', goal: '让第三方 agent 也能接进来干活。',
  });

  // 轮到你 ②: 规划 agent 写完计划交回给你, 你说行才开工
  createTask(db, {
    id: 'R-10', title: '第三方 agent 注册流程', parentId: p2.id,
    state: 'planning', hold: 'confirm', currentActor: admin.id, currentRole: 'decider', priority: 'mid',
    goal: '注册与鉴权草案',
    planMd: '打算这么做:\n- [ ] handle 唯一性校验\n- [ ] 能力声明(能担任哪些角色)\n- [ ] 最小权限的工具白名单',
  });
  appendEvent(db, { taskId: 'R-10', actorId: planP.id, kind: 'plan' }); // 「经过」讲全: 先写了计划, 再交给你拍板
  handoffEvent('R-10', planP.id, admin.id, 'decider', 'planning', 'planning', { from: null, to: 'confirm' }, '计划写完了, 你看下能不能开工');

  // ── 项目 3: 看板体验打磨 ───────────────────────────────────────
  const p3 = createTask(db, {
    id: 'R-12', title: '看板体验打磨', state: 'executing', currentActor: testT.id, currentRole: 'tester', priority: 'mid',
    goal: '看板顺手、移动端不打折 —— 交互细节逐个磨平。',
  });
  createTask(db, { id: 'R-13', title: '详情抽屉点外关闭', parentId: p3.id, state: 'done', currentActor: testT.id, currentRole: 'tester' });
  createTask(db, {
    id: 'R-14', title: '项目/任务分层看板', parentId: p3.id,
    state: 'executing', currentActor: execB.id, currentRole: 'executor', priority: 'hi',
    goal: '项目总览 → 钻进任务 → 再钻子任务, 上箭头逐层弹回。',
    outputsMd: '- web/src/App.tsx (路径栈)', summary: '递归导航已通, 面包屑还在打磨',
  });
  createTask(db, { id: 'R-15', title: '列内拖拽排序', parentId: p3.id, state: 'planning', currentActor: admin.id, currentRole: 'planner', priority: 'lo' });

  // ── 项目 4: 已完结的地基(演示项目「已完结」态与归档区) ────────
  const p4 = createTask(db, {
    id: 'R-16', title: '核心地基 MVP', state: 'done', currentActor: testT.id, currentRole: 'tester',
    priority: 'hi', goal: '把数据层与状态机地基打牢, 支撑之后一切。',
    summary: '四张表 + 状态机 + Markdown 镜像, 全部验收通过。',
  });
  const dep = createTask(db, {
    id: 'R-20', title: 'MCP 工具集接口设计', parentId: p4.id, state: 'done',
    currentActor: execA.id, currentRole: 'executor', summary: '锁定 claim/handoff/raise 的字段命名。',
  });
  handoffEvent('R-16', admin.id, testT.id, 'tester', 'executing', 'done', undefined, '方向做完, 收官');

  // 关系边: R-2 依赖 R-20 的接口定义(抽屉「相关任务」里点得进去)
  createEdge(db, { fromTask: t2.id, toTask: dep.id, type: 'depends_on' });

  // 放在最后建: 让"规划·P"成为最近的规划者 —— 默认路由按 updated_at 取最近, 若被"你"盖过,
  // demo 上就演示不出"交给规划 agent"这条(规则没错, 但数据讲不出故事)。
  createTask(db, {
    id: 'R-11', title: '工具权限模型草案', parentId: p2.id,
    state: 'planning', currentActor: planP.id, currentRole: 'planner', priority: 'lo',
    goal: '每个工具能被哪些角色调用, 最小权限。',
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
  rmSync(dir, { recursive: true, force: true }); // 镜像目录一并重置, 免得留下上一套数据的 .md
  const db = openDb(dbPath);
  return seed(db, dir);
}

// CLI: npm run seed → 重置 data/relay.db 并镜像到 data/tasks/
if (import.meta.url === `file://${process.argv[1]}`) {
  const res = runSeedCli('data/relay.db', 'data/tasks');
  console.log(`✅ seed 完成: ${res.taskCount} 个任务, 镜像 ${res.files.length} 个文件到 data/tasks/`);
}
