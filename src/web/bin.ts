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
  // 默认只绑回环: Relay 没有鉴权, 谁连上谁就能读写 —— 要给局域网其他设备用,
  // 显式 RELAY_HOST=0.0.0.0(等于宣布"这个网段我信"), 不做静默暴露
  const host = process.env.RELAY_HOST ?? '127.0.0.1';
  app.listen({ port, host }).then(() => console.log(`✅ Relay Web 已启动: http://${host}:${port}`))
    .catch((e) => { console.error(e); process.exit(1); });
  // 优雅关闭: 信号 → 停收请求 → process.exit; 库统一在 exit 里关(WAL checkpoint 落盘,
  // better-sqlite3 的 close 是同步的, 放 exit 钩子安全, 且 stdin/异常等其他退出路径也兜住)
  process.on('exit', () => { if (db.open) db.close(); });
  const shutdown = () => { app.close().finally(() => process.exit(0)); };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}
