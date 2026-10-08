import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { uuidv7 } from '../../src/clients/client-ids.js';

describe('uuidv7', () => {
  it('is a version 7 UUID with the time in milliseconds in its first 48 bits', () => {
    const now = Date.UTC(2026, 9, 8, 12, 0, 0, 123);
    const id = uuidv7(now);
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(z.uuid({ version: 'v7' }).safeParse(id).success).toBe(true);
    expect(parseInt(id.replaceAll('-', '').slice(0, 12), 16)).toBe(now);
  });

  it('sorts by time, and ids made in the same millisecond differ', () => {
    const ids = [uuidv7(1), uuidv7(2), uuidv7(Date.UTC(2026, 0, 1)), uuidv7(2 ** 48 - 1)];
    expect([...ids].sort()).toEqual(ids);
    expect(new Set(Array.from({ length: 100 }, () => uuidv7(5))).size).toBe(100);
  });
});
