import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import fastifyStatic from '@fastify/static';
import type { FastifyInstance } from 'fastify';
import { openDb } from '../db/connection';
import { RelayService } from '../service/relay';
import { buildApp } from './api';

export function buildStaticApp(service: RelayService, distDir: string): FastifyInstance {
  const app = buildApp(service);
  app.register(fastifyStatic, { root: distDir });
  return app;
}

// CLI 入口。数据位置可配(RELAY_DB / RELAY_MIRROR): 多实例/演练/测试环境不共用一个库
if (import.meta.url === `file://${process.argv[1]}`) {
  const here = dirname(fileURLToPath(import.meta.url));
  const dist = join(here, '..', '..', 'web', 'dist');
  const dbPath = process.env.RELAY_DB ?? 'data/relay.db';
  const mirrorDir = process.env.RELAY_MIRROR ?? 'data/tasks';
  mkdirSync(dirname(dbPath), { recursive: true });
  const db = openDb(dbPath);
  const service = new RelayService(db, mirrorDir);
  const app = buildStaticApp(service, dist);
  const port = Number(process.env.PORT ?? 3000);
  app.listen({ port, host: '127.0.0.1' }).then(() => console.log(`✅ Relay Web 已启动: http://127.0.0.1:${port}`))
    .catch((e) => { console.error(e); process.exit(1); });
}
