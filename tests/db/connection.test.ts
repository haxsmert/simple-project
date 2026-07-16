import { describe, it, expect } from 'vitest';
import { openDb } from '../../src/db/connection';

describe('openDb', () => {
  it('建出四张核心表', () => {
    const db = openDb(':memory:');
    const names = (db.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name",
    ).all() as { name: string }[]).map((r) => r.name);
    expect(names).toContain('actors');
    expect(names).toContain('tasks');
    expect(names).toContain('edges');
    expect(names).toContain('events');
  });
});
