import { describe, it, expect, afterAll } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDb } from '../../src/db/connection';
import { RelayService } from '../../src/service/relay';
import { buildStaticApp } from '../../src/web/bin';

const dist = mkdtempSync(join(tmpdir(), 'relay-dist-'));
mkdirSync(dist, { recursive: true });
writeFileSync(join(dist, 'index.html'), '<!doctype html><title>Relay</title>');

const db = openDb(':memory:');
const service = new RelayService(db, mkdtempSync(join(tmpdir(), 'relay-st-')));
const app = buildStaticApp(service, dist);
afterAll(() => app.close());

describe('static app', () => {
  it('/ 返回前端 index.html', async () => {
    await app.ready();
    const res = await app.inject({ method: 'GET', url: '/' });
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain('Relay');
  });
  it('/api/board 仍返回 JSON', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/board' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toHaveLength(4);
  });
});
