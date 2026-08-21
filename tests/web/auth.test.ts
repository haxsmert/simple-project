import { describe, it, expect } from 'vitest';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDb } from '../../src/db/connection';
import { RelayService } from '../../src/service/relay';
import { buildApp } from '../../src/web/api';
import { buildStaticApp } from '../../src/web/bin';
import { makeToken, verifyToken, resolveAuth } from '../../src/web/auth';

// 登录门禁契约: 静态壳放行、API 401(不弹原生框)、登录发 HttpOnly cookie、Basic 直连留给集成方
const AUTH = { user: 'bianzhiwen', pass: 'bian2020' };
const basic = (u: string, p: string) => `Basic ${Buffer.from(`${u}:${p}`).toString('base64')}`;

function mk() {
  const db = openDb(':memory:');
  const service = new RelayService(db, mkdtempSync(join(tmpdir(), 'relay-auth-')));
  return buildApp(service, AUTH);
}

describe('web auth(登录页 + 签名 cookie)', () => {
  it('无凭据 API → 401 且不带 WWW-Authenticate(不触发浏览器原生弹窗, 登录页归前端)', async () => {
    const app = mk();
    const res = await app.inject({ method: 'GET', url: '/api/projects' });
    expect(res.statusCode).toBe(401);
    expect(res.headers['www-authenticate']).toBeUndefined();
    expect(res.json().error).toBe('需要登录');
  });

  it('登录对 → HttpOnly cookie, 拿它访问 API 通; 登录错 → 401 人话', async () => {
    const app = mk();
    const login = await app.inject({ method: 'POST', url: '/api/login', payload: { user: AUTH.user, pass: AUTH.pass } });
    expect(login.statusCode).toBe(200);
    const cookie = String(login.headers['set-cookie']);
    expect(cookie).toContain('relay_auth=');
    expect(cookie).toContain('HttpOnly');
    const authed = await app.inject({ method: 'GET', url: '/api/projects', headers: { cookie: cookie.split(';')[0] } });
    expect(authed.statusCode).toBe(200);
    expect(authed.json()).toEqual({ active: [], closed: [] });

    const bad = await app.inject({ method: 'POST', url: '/api/login', payload: { user: AUTH.user, pass: '猜的' } });
    expect(bad.statusCode).toBe(401);
    expect(bad.json().error).toBe('账号或密码不对');
    expect(bad.headers['set-cookie']).toBeUndefined(); // 登录失败不发会话
  });

  it('伪造/过期 token → 401; 合法 token 过期界限由时间戳判', async () => {
    const app = mk();
    const forged = await app.inject({ method: 'GET', url: '/api/projects', headers: { cookie: 'relay_auth=9999999999999.abcd' } });
    expect(forged.statusCode).toBe(401);
    // 直测签名模块: 过期的真 token 不认(签名对但时间过了)
    const past = Date.now() - 40 * 24 * 3600_000;
    const expired = makeToken(AUTH, past);
    expect(verifyToken(expired, AUTH, past + 1000)).toBe(true);
    expect(verifyToken(expired, AUTH)).toBe(false);
  });

  it('Basic 直连留给 API 集成方(不用先登录拿 cookie)', async () => {
    const app = mk();
    const res = await app.inject({ method: 'GET', url: '/api/projects', headers: { authorization: basic(AUTH.user, AUTH.pass) } });
    expect(res.statusCode).toBe(200);
    const bad = await app.inject({ method: 'GET', url: '/api/projects', headers: { authorization: basic(AUTH.user, '猜的') } });
    expect(bad.statusCode).toBe(401);
  });

  it('写操作同闸: 无凭据 POST → 401 不落库; 静态壳放行(登录页由 SPA 自己渲染)', async () => {
    const dist = mkdtempSync(join(tmpdir(), 'relay-authdist-'));
    writeFileSync(join(dist, 'index.html'), '<!doctype html><title>Relay</title>');
    const db = openDb(':memory:');
    const service = new RelayService(db, mkdtempSync(join(tmpdir(), 'relay-auth-st-')));
    const app = buildStaticApp(service, dist, AUTH);
    await app.ready();
    const write = await app.inject({ method: 'POST', url: '/api/tasks', payload: { title: '闯入', goal: 'g' } });
    expect(write.statusCode).toBe(401);
    const shell = await app.inject({ method: 'GET', url: '/' });
    expect(shell.statusCode).toBe(200); // 壳不含数据, 放行 —— 数据全在 /api 闸后
    const list = await app.inject({ method: 'GET', url: '/api/projects', headers: { authorization: basic(AUTH.user, AUTH.pass) } });
    expect(list.json().active).toEqual([]); // 401 的写没有落库
    await app.close();
  });

  it('凭据优先级: env > auth.json > 写死默认(文件坏了/缺字段回退, 不炸启动)', () => {
    expect(resolveAuth({}, null)).toEqual({ user: 'bianzhiwen', pass: 'bian2020' });
    expect(resolveAuth({}, '{"user":"u1","pass":"p1"}')).toEqual({ user: 'u1', pass: 'p1' });
    expect(resolveAuth({ RELAY_PASS: 'envp' }, '{"user":"u1","pass":"p1"}')).toEqual({ user: 'u1', pass: 'envp' });
    expect(resolveAuth({}, '{"pass":"仅密码"}')).toEqual({ user: 'bianzhiwen', pass: '仅密码' });
    expect(resolveAuth({}, '不是json{')).toEqual({ user: 'bianzhiwen', pass: 'bian2020' });
  });

  it('登出: 回收浏览器侧 cookie(Max-Age=0)', async () => {
    const app = mk();
    const res = await app.inject({ method: 'POST', url: '/api/logout', headers: { authorization: basic(AUTH.user, AUTH.pass) } });
    expect(res.statusCode).toBe(200);
    expect(String(res.headers['set-cookie'])).toContain('Max-Age=0');
  });
});
