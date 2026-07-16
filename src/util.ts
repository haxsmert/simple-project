import { randomUUID } from 'node:crypto';

export const now = (): string => new Date().toISOString();
export const uid = (prefix: string): string => `${prefix}_${randomUUID().slice(0, 8)}`;
