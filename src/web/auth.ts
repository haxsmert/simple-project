import { createHmac, timingSafeEqual } from 'node:crypto';

// 登录会话 = 无状态签名 cookie: token = 过期时间戳.HMAC(时间戳)。
// 密钥从凭据派生 —— 不用额外管 secret, 且改密码即全端下线(旧 token 全部失效)。
// 取舍(如实): 登出只是让浏览器删 cookie, 已发 token 到期前仍有效; 要作废一切会话就改密码。
export interface AuthConfig { user: string; pass: string }

export const COOKIE_NAME = 'relay_auth';
export const TTL_MS = 30 * 24 * 3600_000; // 30 天滚动: 个人工具, 别让人天天输密码

const keyOf = (a: AuthConfig) => createHmac('sha256', 'relay-cookie-v1').update(`${a.user}:${a.pass}`).digest();
const sign = (exp: number, a: AuthConfig) => createHmac('sha256', keyOf(a)).update(String(exp)).digest('hex');

export function makeToken(a: AuthConfig, now = Date.now()): string {
  const exp = now + TTL_MS;
  return `${exp}.${sign(exp, a)}`;
}

export function verifyToken(token: string | undefined, a: AuthConfig, now = Date.now()): boolean {
  if (!token) return false;
  const [expStr, sig] = token.split('.');
  const exp = Number(expStr);
  if (!Number.isFinite(exp) || exp < now) return false;
  const want = Buffer.from(sign(exp, a));
  const got = Buffer.from(sig ?? '');
  return got.length === want.length && timingSafeEqual(got, want);
}

// Basic 直连留给 API 集成方(Hermes/curl 一行 -u 就通, 不用先跑登录拿 cookie)
export function checkBasic(header: string | undefined, a: AuthConfig): boolean {
  if (!header?.startsWith('Basic ')) return false;
  const got = Buffer.from(header.slice(6), 'base64');
  const want = Buffer.from(`${a.user}:${a.pass}`);
  return got.length === want.length && timingSafeEqual(got, want);
}

export function checkLogin(user: unknown, pass: unknown, a: AuthConfig): boolean {
  if (typeof user !== 'string' || typeof pass !== 'string') return false;
  const got = Buffer.from(`${user}:${pass}`);
  const want = Buffer.from(`${a.user}:${a.pass}`);
  return got.length === want.length && timingSafeEqual(got, want);
}

export function cookieValue(cookieHeader: string | undefined, name: string): string | undefined {
  for (const part of (cookieHeader ?? '').split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === name) return v.join('=');
  }
  return undefined;
}
