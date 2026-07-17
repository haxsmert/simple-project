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

  app.get('/api/board', wrap(() => service.board()));
  app.get('/api/projects', wrap(() => service.projectBoard()));
  app.get('/api/projects/:id/board', wrap((req) => service.taskBoard(req.params.id)));
  app.get('/api/tasks-board', wrap(() => service.allTasksBoard()));
  app.get('/api/tree', wrap(() => service.tree()));
  app.get('/api/actors', wrap(() => service.listActors()));
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
  app.post('/api/tasks', wrap((req) => service.createTask(req.body)));
  app.post('/api/tasks/:id/claim', wrap((req) => service.claim(req.params.id, req.body.actor, req.body.role)));
  app.post('/api/tasks/:id/plan', wrap((req) => service.submitPlan(req.params.id, req.body.byActor, req.body.planMd)));
  app.post('/api/tasks/:id/output', wrap((req) =>
    service.submitOutput(req.params.id, req.body.byActor, { outputsMd: req.body.outputsMd, summary: req.body.summary })));
  app.post('/api/tasks/:id/comment', wrap((req) => service.comment(req.params.id, req.body.actor, req.body.body)));
  app.post('/api/handoff', wrap((req) => service.handoff(req.body)));
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
