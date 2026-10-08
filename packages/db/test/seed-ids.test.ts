// Every fixed id in the seed is an RFC 9562 UUID that the API contracts accept: zod's z.uuid()
// (as packages/types uses) refuses ids whose variant digit is not 8, 9, a or b, so a seeded record
// with such an id breaks the screens locally.
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import * as seed from '../prisma/seed-data.js';

const UUID_SHAPED = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Every uuid-shaped string anywhere in the SEED_* exports, with where it was found. */
function idsIn(value: unknown, path: string, found: [string, string][]): [string, string][] {
  if (typeof value === 'string') {
    if (UUID_SHAPED.test(value)) found.push([path, value]);
  } else if (Array.isArray(value)) {
    value.forEach((item, i) => idsIn(item, `${path}[${i}]`, found));
  } else if (value && typeof value === 'object') {
    for (const [key, item] of Object.entries(value)) idsIn(item, `${path}.${key}`, found);
  }
  return found;
}

describe('seed ids', () => {
  const ids = Object.entries(seed)
    .filter(([name]) => name.startsWith('SEED_'))
    .flatMap(([name, value]) => idsIn(value, name, []));

  it('are all UUIDs the contracts accept', () => {
    expect(ids.length).toBeGreaterThan(50);
    const refused = ids.filter(([, id]) => !z.uuid().safeParse(id).success);
    expect(refused).toEqual([]);
  });

  it('are all different', () => {
    const values = ids.map(([, id]) => id.toLowerCase());
    expect(new Set(values).size).toBe(values.length);
  });
});
