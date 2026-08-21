import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { openDb } from '../db/connection';
import { RelayService } from '../service/relay';
import { buildServer } from './server';

// 数据位置可配(RELAY_DB / RELAY_MIRROR), 与 Web 入口同一约定 —— 两个入口共用同一个库才是一个系统
const dbPath = process.env.RELAY_DB ?? 'data/relay.db';
const mirrorDir = process.env.RELAY_MIRROR ?? 'data/tasks';
mkdirSync(dirname(dbPath), { recursive: true });
const db = openDb(dbPath);
const service = new RelayService(db, mirrorDir);
const server = buildServer(service);
// 优雅关闭: MCP 宿主(Claude Code 等)结束会话时给信号或直接收走 stdio —— 关库让 WAL checkpoint 落盘
process.on('exit', () => { if (db.open) db.close(); });
process.on('SIGINT', () => process.exit(0));
process.on('SIGTERM', () => process.exit(0));
await server.connect(new StdioServerTransport());
