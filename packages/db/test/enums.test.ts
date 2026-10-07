// packages/types/src/db-enums.ts must match the Prisma schema. If this fails after an enum
// change, run `pnpm --filter @firmivra/db gen:enums` and commit the result.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { OUTPUT_PATH, SCHEMA_PATH, parseEnums, render } from '../prisma/generate-enums.js';
import * as prismaEnums from '../src/generated/prisma/enums.js';

const schema = readFileSync(SCHEMA_PATH, 'utf8');

describe('database enums in packages/types', () => {
  it('db-enums.ts is up to date with the schema', () => {
    const current = readFileSync(OUTPUT_PATH, 'utf8').replace(/\r\n/g, '\n');
    expect(current).toBe(render(schema));
  });

  it('reads every enum and value that Prisma generates', () => {
    const parsed = Object.fromEntries(parseEnums(schema).map((e) => [e.name, e.values]));
    const generated = Object.fromEntries(
      Object.entries(prismaEnums).map(([name, values]) => [name, Object.values(values)]),
    );
    expect(parsed).toEqual(generated);
  });
});
