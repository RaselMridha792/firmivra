import { describe, expect, it } from 'vitest';
import { z } from 'zod';

// The browser's Zod runs jitless, so it never tries `new Function` (a CSP 'unsafe-eval' report).
describe('instrumentation-client', () => {
  it('turns Zod jitless before any schema is built, and parsing still works', async () => {
    await import('./instrumentation-client');
    expect(z.config().jitless).toBe(true);
    const schema = z.object({ name: z.string(), count: z.number().int() });
    expect(schema.parse({ name: 'synthetic', count: 2 })).toEqual({ name: 'synthetic', count: 2 });
    expect(schema.safeParse({ name: 'synthetic', count: 'two' }).success).toBe(false);
  });
});
