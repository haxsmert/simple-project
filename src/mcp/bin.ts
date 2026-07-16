import { mkdirSync } from 'node:fs';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { openDb } from '../db/connection';
import { RelayService } from '../service/relay';
import { buildServer } from './server';

mkdirSync('data', { recursive: true });
const db = openDb('data/relay.db');
const service = new RelayService(db, 'data/tasks');
const server = buildServer(service);
await server.connect(new StdioServerTransport());
