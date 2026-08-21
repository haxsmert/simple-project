import { describe, it, expect } from 'vitest';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDb } from '../../src/db/connection';
import { RelayService } from '../../src/service/relay';
import { buildApp } from '../../src/web/api';
import { buildStaticApp } from '../../src/web/bin';

// HTTP Basic 全站门禁: 页面与 API 同闸(挡"局域网内谁都能写"); 无鉴权配置时不设闸(测试/嵌入场景)
const AUTH = { user: 'bianzhiwen', pass: 'bian2020' };
const basic = (u: string, p: string) => `Basic ${Buffer.from(`${u}:${p}`).toString('base64')}`;

function mk() {
  const db = openDb(':memory:');
  const service = new RelayService(db, mkdtempSync(join(tmpdir(), 'relay-auth-')));
  return buildApp(service, AUTH);
}

describe('web auth(HTTP Basic 门禁)', () => {
  it('无凭据 → 401 + WWW-Authenticate(触发浏览器登录框)+ 人话提示', async () => {
    const app = mk();
    const res = await app.inject({ method: 'GET', url: '/api/projects' });
    expect(res.statusCode).toBe(401);
    expect(res.headers['www-authenticate']).toContain('Basic');
    expect(res.json().error).toMatch(/需要登录/);
  });

  it('错密码 → 401; 对凭据 → 200 真数据', async () => {
    const app = mk();
    const bad = await app.inject({ method: 'GET', url: '/api/projects', headers: { authorization: basic('bianzhiwen', '猜的') } });
    expect(bad.statusCode).toBe(401);
    const good = await app.inject({ method: 'GET', url: '/api/projects', headers: { authorization: basic(AUTH.user, AUTH.pass) } });
    expect(good.statusCode).toBe(200);
    expect(good.json()).toEqual({ active: [], closed: [] });
  });

  it('写操作同闸: 无凭据 POST → 401, 不落库', async () => {
    const app = mk();
    const res = await app.inject({ method: 'POST', url: '/api/tasks', payload: { title: '闯入', goal: 'g' } });
    expect(res.statusCode).toBe(401);
    const list = await app.inject({ method: 'GET', url: '/api/projects', headers: { authorization: basic(AUTH.user, AUTH.pass) } });
    expect(list.json().active).toEqual([]); // 401 的写没有落库
  });

  it('静态页面也在闸内(SPA 首屏就是弹登录框的时机), 带凭据放行', async () => {
    const dist = mkdtempSync(join(tmpdir(), 'relay-authdist-'));
    writeFileSync(join(dist, 'index.html'), '<!doctype html><title>Relay</title>');
    const db = openDb(':memory:');
    const service = new RelayService(db, mkdtempSync(join(tmpdir(), 'relay-auth-st-')));
    const app = buildStaticApp(service, dist, AUTH);
    await app.ready();
    const anon = await app.inject({ method: 'GET', url: '/' });
    expect(anon.statusCode).toBe(401);
    const authed = await app.inject({ method: 'GET', url: '/', headers: { authorization: basic(AUTH.user, AUTH.pass) } });
    expect(authed.statusCode).toBe(200);
    expect(authed.body).toContain('Relay');
    await app.close();
  });
});
