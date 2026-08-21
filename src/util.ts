import { randomBytes } from 'node:crypto';

export const now = (): string => new Date().toISOString();
// 12 个十六进制位 = 完整 48bit 熵(UUID 截 8 位只有 32bit, 事件量攒起来后生日碰撞不可忽略)
export const uid = (prefix: string): string => `${prefix}_${randomBytes(6).toString('hex')}`;
