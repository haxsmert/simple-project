# Relay 设计文档

> 代号 **Relay(接力)** — 占位名。一个"人和 agent 都是一等协作者"的轻量任务系统。
> 日期: 2026-07-16 · 状态: 设计已确认, 待评审 → 进入实现计划

---

## 1. 背景与定位

参考 Jira / 飞书项目 / GitHub Projects / todolist 类产品, 做一版**轻量级**任务系统。核心差异化定位:

> **协作维度不只是"多个人", 而是"多个行动者"。** 哪怕永远只有一个人类用户, 也是以"你 + 一队 agent"的方式工作。所以任务的负责人/协作者**不假设是人**——它是一个抽象角色, 可能是你, 也可能是某个 agent。

- **初期**: 纯个人使用(你一个人 + 一队 agent, agent 通过 MCP 接入)。
- **未来**: 加"更多人类"只是往同一套"行动者"抽象里多塞一类, 不推倒重来。避免"先做个人版、以后打补丁改协作版"。

### 一句话

任务作为"接力棒", 在不同角色(规划/执行/测试/提问/决策)之间换手; 行动者可能是你、也可能是任何一个 agent。

---

## 2. 核心概念与数据模型

整个系统只有**四个概念**, 一切场景都是它们的组合(无特例、无补丁):

| 概念 | 说明 |
|---|---|
| **Actor 行动者** | 你 或 某个 agent。统一抽象, 任务不假设负责人是人。agent 注册后即一等 Actor。 |
| **Role 角色** | 规划/确认、执行、测试、提问、决策。角色是"此刻在这个任务上扮演什么", **不绑死在 Actor 身上**——同一 agent 这个任务当执行者、那个任务当测试者。 |
| **Task 任务** | 唯一的结构单位。**递归**——一个够大的任务就是"项目", 不存在独立的"项目/子任务"概念。 |
| **Edge 关系边** | 任务之间的有向关系: `阻塞 blocks`、`依赖 depends_on`、`待确认 clarifies`、`引出 spawns`。 |

### 2.1 状态机(约定俗成的固定骨架 · 2026-07-17 改版: 阶段与挂起正交)

```
主干阶段 state: 待规划 planning → 执行中 executing → 测试中 testing → 完成 done
挂起 hold(平行字段, 类似"锁定/中断"):
  confirm  等确认 —— 本阶段产出已提交, 等决策者批准前进一步; 打回 = 原地解除
  decision 等决策 —— 卡住提问, 全部答复后原地继续
```

- **挂起不是阶段**: 任务永远处在主干某一站, 挂起是"原地举手", 不是搬到另一站。
  除「完成」外任何阶段都可能被中断, 且可中断多次(答复后可再问; decision 中可追加并发提问)。
- 确认关可以跳过, 但**计划不能跳过**: 从计划阶段推进(直接开工或提交等确认)必须先有 inputs_md。
- **固定、不做可配置**(改动场景少, 不为可配置而可配置, 不做成花哨的工作流引擎)。
- 允许**跳过确认 / 手动换手**; 系统按行为推断给**默认路由**建议, 但不强制。
- 这是设计里刻意"轻"的部分: 机制是对的, 落地不僵硬。

### 2.2 数据表草案(SQLite, 真相源)

```sql
-- 行动者: 人和 agent 同一张表, 用 type 区分
actors(
  id          TEXT PRIMARY KEY,      -- 'you' / 'agent-exec-a' ...
  name        TEXT NOT NULL,         -- '你' / '执行·A'
  type        TEXT NOT NULL,         -- 'human' | 'agent'
  handle      TEXT,                  -- agent 的 MCP 身份标识
  created_at  TEXT NOT NULL
)

-- 任务: 递归靠 parent_id 自引用; 信息包的"输入/产出"就近存 markdown 字段, 便于文件镜像
tasks(
  id            TEXT PRIMARY KEY,    -- 'R-142'
  title         TEXT NOT NULL,
  parent_id     TEXT REFERENCES tasks(id),   -- NULL = 顶层("项目"只是 parent 为空的大任务)
  state         TEXT NOT NULL,       -- 主干阶段: planning|executing|testing|done
  hold          TEXT,                -- 挂起(平行字段): confirm|decision|NULL
  current_actor TEXT REFERENCES actors(id),  -- 接力棒此刻在谁手上
  current_role  TEXT,                -- planner|executor|tester|questioner|decider
  goal          TEXT,                -- 目标意图(输入槽)
  inputs_md     TEXT,                -- 确认后的计划 + 引用(输入槽, markdown)
  outputs_md    TEXT,                -- 产物清单 + 链接(产出槽, markdown)
  summary       TEXT,                -- 一句话摘要(产出槽)
  priority      TEXT,                -- hi|mid|lo
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL
)

-- 关系边: 有向; 待确认/引出 也走这里, 不发明新表
edges(
  id          TEXT PRIMARY KEY,
  from_task   TEXT NOT NULL REFERENCES tasks(id),
  to_task     TEXT NOT NULL REFERENCES tasks(id),
  type        TEXT NOT NULL,         -- blocks|depends_on|clarifies|spawns
  created_at  TEXT NOT NULL
)

-- 交互记录(Thread): append-only, 换手/评论/提问/决策全在此
events(
  id          TEXT PRIMARY KEY,
  task_id     TEXT NOT NULL REFERENCES tasks(id),
  actor_id    TEXT NOT NULL REFERENCES actors(id),
  kind        TEXT NOT NULL,         -- handoff|comment|output|clarify|decide|claim|plan
  to_actor    TEXT,                  -- 交给了谁; state_from/to + hold_from/to 记录位置变化(实现层已加)
  role_from   TEXT,                  -- 换手起始角色
  role_to     TEXT,                  -- 换手目标角色
  body        TEXT,                  -- markdown
  created_at  TEXT NOT NULL
)
```

---

## 3. 协作机制(换手怎么发生)

### 3.1 换手 Handoff

**换手 = 改任务的 `current_actor` + `current_role` + 追加一条 `handoff` event。**

- 同一任务在流水线里向前走, **不新建任务**。
- 执行者干完 → 换手给测试者角色时, 测试者的"输入" = 执行者刚才写的"产出"(读同一任务的 `outputs_md`)。这就是"信息包换手"的落地。

### 3.2 待确认(阻塞式澄清)—— 一等机制, 不是补丁

执行者干到一半遇到不清楚的:

1. `raise_clarification(question, options?, blocking=true)`
2. 系统**新建一个子任务**(goal = 问题), 并连一条 `clarifies` 边指回父任务(同时可加 `spawns` 边表示"这个问题引出了它")。
3. 父任务自动挂起(`hold=decision`, **阶段原地不动**——挂起是举手, 不是搬站)。
4. 决策者答复 → 答案写入该澄清任务的 `outputs_md`/`summary` → 全部答复后父任务解除挂起、**在原阶段续跑**。

**全程是"任务 + 边 + 状态"的组合, 没有特例代码。** 这正是"机制统一、无补丁"的体现。

**设计决策(状态机权威 · 2026-07-17 改版)**: 位置(阶段×挂起)变更走 `canMove` 校验——**状态机是位置变更的唯一权威**, 不存在"绕过校验直接改状态"的第二条路径。推论:
- 提问挂起**除「完成」外任何阶段可触发**, 且可多次; `decision` 的设/解只走 clarification 模块, handoff 一律拒——保住"问题挂着任务不能跑"的不变量。
- 一个父任务可挂多个待确认(decision 挂起中允许追加提问); **仅当所有待确认都答复完毕, 父任务才解除挂起、在原阶段续跑**。

### 3.3 信息包的四槽位 ⟷ 机制映射

UI 上的"四槽位"不是四张新表, 而是对已有机制的呈现:

| UI 槽位 | 机制落地 |
|---|---|
| 输入 Inputs | `tasks.goal` + `tasks.inputs_md` + 依赖任务(`depends_on`)的产出 |
| 产出 Outputs | `tasks.outputs_md` + `tasks.summary` |
| 待确认 Clarification | 由 `clarifies` 边关联的子任务(状态驱动), **复用 task+edge** |
| 交互记录 Thread | `events` 表(append-only) |

### 3.4 agent 通过 MCP 一等公民接入

agent 不猜文件格式, 走干净的 MCP 工具集:

| 工具 | 作用 |
|---|---|
| `list_my_tasks(actor, role?)` | 我此刻手上有哪些接力棒 |
| `get_task(id)` | 取完整信息包(输入/产出/待确认/记录/子任务/边) |
| `claim(task_id)` | 领取任务 |
| `handoff(task_id, to_role, to_actor?, note)` | 换手 |
| `submit_output(task_id, artifacts[], summary)` | 交产出 |
| `raise_clarification(task_id, question, options?, blocking)` | 触发待确认 |
| `answer_clarification(clar_task_id, answer)` | 答复澄清、解冻父任务 |
| `comment(task_id, body)` | 追加评论 |

**设计要点**: agent 之所以能可靠接力, 靠的是"领任务时拿到定义良好的输入包、交任务时写定义良好的产出包"——把信息流入流出变成机制, 而不是靠每个 agent 自由发挥。服务"杠杆必须可信、反黑箱"。

---

## 4. 技术架构

### 4.1 结构

- **共享核心库(core)**: 数据层 + 业务逻辑(换手、待确认、状态路由), 是唯一逻辑真相。
- **两个入口, 共用同一 SQLite 文件**(单一数据真相源, 避免多真相):
  1. **Web 服务**(Fastify): 提供本地 Web UI(浏览器打开即用, 最轻)。
  2. **MCP server**(stdio): agent 接入口, 由 Claude Code 之类的客户端拉起。
- **文件镜像**: 每个任务变更后**单向** DB→Markdown 写一份 `tasks/R-xxx.md`(frontmatter + 正文)。可 git、可 diff、可脱离 app 直接看。**真相源是 DB, 文件是镜像**(单向, 避免双写冲突)。

### 4.2 并发

SQLite 开 **WAL 模式**: 多读 + 单写, 个人规模足够。better-sqlite3 同步 API, 简单可靠。

### 4.3 技术栈(TypeScript 一把梭)

| 层 | 选型 |
|---|---|
| 语言 | TypeScript |
| 后端/Web | Node + Fastify |
| 数据库 | SQLite + better-sqlite3(WAL) |
| MCP | `@modelcontextprotocol/sdk`(stdio) |
| 前端 | Vite + React |
| 镜像 | DB→Markdown 写入器(frontmatter) |

一个仓库、共享 core、两个入口。

---

## 5. 关键界面

已产出可视化 mockup(深色为主视觉, 支持浅色), 演示两屏:

1. **看板视图** — 六列固定状态机; 人=蓝圆点 / agent=绿方块(颜色+形状双重编码); "待决策"自成一列琥珀高亮; 阻塞与衍生用关系边串因果。
2. **任务详情** — 四槽位信息包(输入/产出/待确认/交互记录); 待确认全链路闭环; 面包屑体现"项目即大任务", 侧栏列子任务与四类边。

视觉语言: 信息密但有序的深色控制台风。**mockup 仅定信息架构与视觉方向, 非最终视觉。**

---

## 6. MVP 范围

### 第一版做

- 递归任务 + 四类关系边
- 固定四阶段主干 + 平行挂起字段 + 默认路由(可跳过确认/手动换手)
- Actor(你 + 注册 agent), 人/agent 双色呈现
- 四槽位信息包(输入/产出/待确认/交互记录)
- Web UI: 看板 + 任务详情 + 任务树(默认展开两层)
- SQLite 真相源 + 单向文件镜像
- MCP server 核心工具集(§3.4)

### 明确先不做(往后排, 都能往现有抽象里加)

- 多人类账号 / 权限
- 通知提醒
- 日历 / 工时 / 迭代 / 燃尽图
- 自定义工作流编辑
- 与 GitHub / 飞书双向同步
- 移动端

### 已定的小决策

- **信息包内容**: MVP 用 **Markdown 文本 + 外链**, 附件走文件镜像目录; 暂不做富文本/DB blob(对应 mockup 里 R-149 的问题, 取方案 A, 保持轻)。

---

## 7. 未来演进(团队 / 多人类)

加"更多人类"= 往 `actors` 表多塞 `type='human'` 的行 + 加账号/权限层。核心数据模型(任务/角色/边/事件)不变。这正是"从第一天起把人和 agent 都当一等协作者"换来的:团队化不是重写, 是延展。

---

## 8. 设计原则回溯(为什么这么定)

- **机制统一、无特例**: 项目=大任务、待确认=任务+边、信息包=已有字段的呈现。避免为每种场景发明新概念。
- **底层对、落地轻**: 状态机是约定俗成的固定骨架, 但 UI 默认只展开一两层、不逼你直面整棵树。
- **可信杠杆、反黑箱**: DB 真相源 + 文件镜像(看得懂、改得动、可 diff); agent 走定义良好的 MCP 接口而非猜格式。
- **不为自动化而自动化**: 力气花在"任务组合 + 信息 I/O", 而非把流转做成可配置引擎。

---

## 9. 应用层分层:项目 / 任务 / 执行任务(2026-07-16 决策)

底层任务树无限嵌套**不变**;应用层按**深度**叠一层人可理解的分层:

| 层 | 定义(深度) | 谁管 | 操作 |
|---|---|---|---|
| **项目** | 顶层任务(parentId 为空) | 人 | 建项目、看项目看板 |
| **任务** | 项目的直接子(深度1) | 人 | 往项目追加任务、列内拖拽调序、看任务看板 |
| **执行任务** | 深度 ≥2 | **agent 自动编排**(经 MCP) | 基于执行需要自动创建/启动,人一般不碰;仅在任务详情里可见 |

**UI**:项目看板(默认首页) → 点项目钻进**该项目的任务看板** → 点任务看详情(执行子树在详情里)。原"全部任务扁平看板"去掉;任务树视图保留看全貌。
**分层机制**:纯深度约定,不加 kind 字段、不改数据模型本质。
**排序**:列内拖拽(每个状态列内任务可调序),需给任务加 `rank` 排序字段——**第二阶段**做;第一阶段先做看板分层 + 钻取 + 追加,不改 schema。
