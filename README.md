# Relay

一个**中间任务系统**：人和 agent 都是一等协作者，任务像接力棒在角色之间换手。它坐在你和一队 agent 中间——agent 经 MCP 领活、交产出、卡住提问；你经网页或 IM 机器人（走 HTTP API）拍板、答复、调度。

- **真相源**：一个 SQLite 文件（`data/relay.db`），另有单向 Markdown 镜像（`data/tasks/R-*.md`）可 git、可 diff、可脱离应用直接读。
- **三种交互方式，同一套流程与守卫**：Web 页面 / HTTP API / MCP 工具——走哪条路，状态机与闸门都一样。

## 模型（一页讲清）

**任务是唯一结构单位**，递归——顶层任务就是“项目”，够大的任务再拆子任务。

**主干四阶段**是一条线，**挂起是与它平行的中断字段**（不是阶段，是“原地举手”）：

```
state: 待规划 planning → 执行中 executing → 测试中 testing → 完成 done
hold:  confirm 等确认 —— 本阶段产出已提交，等决策者批准前进一步；打回＝原地解除
       decision 等决策 —— 卡住提问，全部答复后原地继续
```

除「完成」外任何阶段都可能被中断、可中断多次。

**四种角色**（planner 规划 / executor 执行 / tester 测试 / decider 决策）：角色是“此刻在这个任务上扮演什么”，不绑死在人或 agent 身上。「提问」是动作（`raise_clarification`），不是角色。

**两种关系边**：`depends_on`（A 依赖 B 的产出）、`clarifies`（问题卡 → 所属任务）。

**队列即优先级**：看板列内越靠前越优先；拖拽调序＝调优先级（`rank` 最优先服从人的排列，未排过的按 `priority` 权重落位）。

### 流程守卫（后端机制层，三种交互方式都拦）

| 守卫 | 含义 |
|---|---|
| 计划是推进门票 | 从待规划推进（直接开工或提交等确认）必须先有计划（`plan_md`） |
| 确认可跳过，计划不可 | 「开始执行」跳过的是确认关，不是计划 |
| 自批闸 | 提交确认的人不能当自己这份计划/产出的批准人 |
| 原地改派保角色 | 位置（阶段×挂起）不动的换手＝纯换人，不许顺带改角色 |
| claim 只领无主 | 已有人做的、挂起中的都不可 `claim`（换人走 `handoff` 改派，有角色守卫） |
| 决策只归答复管 | `decision` 挂起的设/解只走提问/答复，`handoff` 一律拒 |
| 父子最小不变量 | 完成的任务不能有没完成的子（进「完成」硬拦；进测试只提示） |

## 快速开始

```bash
npm install
npm run seed          # 重置并灌 demo 数据（会删库重建——先停掉正在跑的服务）
PORT=3200 npm run web # Web + HTTP API 单端口
npm run mcp           # MCP server（stdio）
npm test              # 后端测试
npx vitest run --config web/vite.config.ts web/  # 前端测试
```

Claude Code 侧接入 MCP（`.mcp.json`）：

```json
{ "mcpServers": { "relay": { "command": "npx", "args": ["tsx", "src/mcp/bin.ts"], "cwd": "<本仓库路径>" } } }
```

## HTTP API（页面与 IM 机器人共用）

| 方法与路径 | 作用 |
|---|---|
| `GET /api/projects` | 项目看板（四阶段列，项目卡带「待你处理」计数） |
| `GET /api/projects/:id/board` · `GET /api/tasks-board` | 某项目 / 全部项目的一层任务看板 |
| `GET /api/tree` | 任务树（递归） |
| `GET /api/tasks?state=&hold=&unassigned=1` | 任务过滤（发现面） |
| `GET /api/tasks/:id` | 任务完整信息包（内容/产出/问题/历史/子任务/关系） |
| `GET /api/pending/:actorId` | **“轮到某人处理”结构化清单**（IM 推卡片数据源：等拍板附计划全文；等答复附问题文本＋结构化选项＋所属任务） |
| `GET /api/actors` · `GET /api/routing` | 行动者列表 · 默认路由表（角色→最近扮演者） |
| `POST /api/tasks` · `PATCH /api/tasks/:id` · `DELETE /api/tasks/:id` | 建任务（`title` 必填；`parentId`/`goal`/`priority`/`actor`/`role`；不可直建挂起位） · 改标题/目标/优先级（记「经过」） · 硬删（有子任务拒；删未决问题卡＝撤回提问） |
| `POST /api/handoff` | 换手（`toState` 阶段；`toHold` 挂起变化：`"confirm"`＝提交把关，`null` 或 `"none"`＝解除。提交确认/批准/打回/改派都走它） |
| `POST /api/tasks/:id/plan` · `/output` · `/comment` | 写计划 · 交产出＋摘要 · 留言 |
| `POST /api/tasks/:id/claim` | 领取**无主**任务（已有人做的走 handoff 改派；挂起中不可领） |
| `POST /api/clarifications` · `POST /api/clarifications/:id/answer` | 提问挂起 · 答复（全部答复后原地解冻） |
| `POST /api/actors` · `POST /api/edges` · `POST /api/reorder` | 注册行动者 · 建关系边 · 列内排序 |

出错一律 `400 {"error": "<中文人话，说清哪条守卫拦的、该走哪条路>"}`。

## MCP 工具（agent 的全量能力面，共 17 个）

| 类 | 工具 |
|---|---|
| 查 | `list_my_tasks` · `list_tasks`（找活：未认领/按阶段/按挂起） · `list_pending`（待办清单） · `get_task` · `list_actors` |
| 建 | `create_task`（可指定父任务→拆子任务） · `link_edge` · `register_actor` |
| 改 | `update_task`（标题/目标/优先级，记「经过」） · `claim` · `handoff` · `submit_plan` · `submit_output` |
| 删 | `delete_task`（级联边/历史/镜像；删未决问题卡＝撤回提问并自动解冻父任务） |
| 流程 | `raise_clarification` · `answer_clarification` · `comment` |

**agent 的典型循环**（Relay 不关心你是轮询还是触发，能力面自足）：

```
list_tasks(unassigned) → claim → get_task（读目标/计划/依赖产出）
  → submit_plan → handoff(to_hold=confirm) 等批准     ← 或有计划直接 handoff(to_state=executing)
  → 干活……卡住则 raise_clarification（任务原地挂起）
  → submit_output → handoff(to_state=testing) 交验收
```

## IM 集成（飞书/Hermes 一类机器人）

1. 定期拉 `GET /api/pending/admin` → `confirms`（附计划全文）与 `decisions`（附问题文本＋`{key,text}` 选项数组，可直接渲染按钮）。
2. 用户点选项 → 回调 `POST /api/clarifications/:id/answer`；点批准/打回 → 回调 `POST /api/handoff`（带 `toHold`）。
3. 用户发“加个任务” → `POST /api/tasks`。

## 更多文档

- 设计文档（模型来龙去脉、机制决策）：`docs/superpowers/specs/2026-07-16-relay-design.md`
- 实现计划存档：`docs/superpowers/plans/`
