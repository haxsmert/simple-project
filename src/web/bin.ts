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

// CLI 入口
if (import.meta.url === `file://${process.argv[1]}`) {
  const here = dirname(fileURLToPath(import.meta.url));
  const dist = join(here, '..', '..', 'web', 'dist');
  mkdirSync('data', { recursive: true });
  const db = openDb('data/relay.db');
  const service = new RelayService(db, 'data/tasks');
  const app = buildStaticApp(service, dist);
  const port = Number(process.env.PORT ?? 3000);
  app.listen({ port, host: '127.0.0.1' }).then(() => console.log(`✅ Relay Web 已启动: http://127.0.0.1:${port}`))
    .catch((e) => { console.error(e); process.exit(1); });
}
