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
await server.connect(new StdioServerTransport());
