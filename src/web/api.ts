import Fastify, { type FastifyInstance } from 'fastify';
import type { RelayService } from '../service/relay';

export function buildApp(service: RelayService): FastifyInstance {
  const app = Fastify({ logger: false });

  // 统一: 把 service 调用包成 handler, 抛错 → 400 {error}
  const wrap =
    (fn: (req: any) => unknown) =>
    async (req: any, reply: any) => {
      try {
        return fn(req);
      } catch (e) {
        reply.code(400);
        return { error: e instanceof Error ? e.message : String(e) };
      }
    };

  // 项目总览(项目层透镜): { active: 执行中项目[], closed: 已完结项目[] }, 卡带 attention + 最近动静
  app.get('/api/projects', wrap(() => service.projectOverview()));
  app.get('/api/projects/:id/board', wrap((req) => service.taskBoard(req.params.id)));
  app.get('/api/tasks-board', wrap(() => service.allTasksBoard()));
  app.get('/api/tree', wrap(() => service.tree()));
  app.get('/api/actors', wrap((req) => service.listActors(req.query.type)));
  // 默认路由表: 角色 → 默认派给谁(界面据此预填"交给谁", 不必每次手选)
  app.get('/api/routing', wrap(() => service.routing()));
  // 全局任务过滤(发现面): ?state= &hold=confirm|decision|none|any &unassigned=1
  app.get('/api/tasks', wrap((req) => service.listTasks({
    state: req.query.state, hold: req.query.hold,
    unassigned: req.query.unassigned === '1' || req.query.unassigned === 'true',
  })));
  // "轮到某人处理"的结构化清单(IM/机器人集成的推送数据源): 等拍板附计划, 等答复附问题+选项+所属任务
  app.get('/api/pending/:actorId', wrap((req) => service.pendingFor(req.params.actorId)));
  app.get('/api/tasks/:id', wrap((req) => service.getPackage(req.params.id)));

  app.post('/api/actors', wrap((req) => service.registerActor(req.body)));
  // 字段别名兼容: MCP 词汇(actor/role)打到 HTTP 曾被静默吞掉 —— 静默丢字段是给集成方埋雷
  app.post('/api/tasks', wrap((req) => service.createTask({
    ...req.body,
    currentActor: req.body.currentActor ?? req.body.actor,
    currentRole: req.body.currentRole ?? req.body.role,
  })));
  // 信息更新(标题/目标/优先级, 记「经过」)与硬删(级联边/事件/镜像; 有子任务拒; 未决问题卡被删=撤回提问)
  app.patch('/api/tasks/:id', wrap((req) => service.updateTaskInfo(req.params.id, req.body.byActor, req.body)));
  app.delete('/api/tasks/:id', wrap((req) => service.deleteTask(req.params.id, (req.query.byActor as string) ?? 'admin')));
  app.post('/api/tasks/:id/claim', wrap((req) => service.claim(req.params.id, req.body.actor, req.body.role)));
  app.post('/api/tasks/:id/plan', wrap((req) => service.submitPlan(req.params.id, req.body.byActor, req.body.planMd)));
  app.post('/api/tasks/:id/output', wrap((req) =>
    service.submitOutput(req.params.id, req.body.byActor, { outputsMd: req.body.outputsMd, summary: req.body.summary })));
  app.post('/api/tasks/:id/comment', wrap((req) => service.comment(req.params.id, req.body.actor, req.body.body)));
  // toHold 取值与 MCP 对齐: 'none' 也表示解除挂起(此前 HTTP 只认 null 字面量, 跨通道词汇打架)
  app.post('/api/handoff', wrap((req) => service.handoff({
    ...req.body,
    toHold: req.body.toHold === 'none' ? null : req.body.toHold,
  })));
  app.post('/api/clarifications', wrap((req) => service.raiseClarification(req.body)));
  app.post('/api/clarifications/:id/answer', wrap((req) =>
    service.answerClarification({ clarTaskId: req.params.id, byActor: req.body.byActor, answer: req.body.answer })));
  app.post('/api/edges', wrap((req) => service.linkEdge(req.body)));
  app.post('/api/reorder', wrap((req) => {
    service.reorder(req.body.ids);
    return { ok: true };
  }));

  return app;
}
