import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { DB } from '../db/connection';
import { assemblePackage } from '../core/infoPackage';
import { renderTaskMarkdown } from './markdown';

export function mirrorTask(db: DB, dir: string, id: string): string {
  mkdirSync(dir, { recursive: true });
  const md = renderTaskMarkdown(assemblePackage(db, id));
  const path = join(dir, `${id}.md`);
  writeFileSync(path, md, 'utf8');
  return path;
}
