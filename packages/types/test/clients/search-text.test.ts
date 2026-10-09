import { describe, expect, it } from 'vitest';
import type { z } from 'zod';
import {
  ListClientsQuery,
  ListFirmApplicationsQuery,
  ListFirmsQuery,
  ListInvoicesQuery,
  ListMyInvoicesQuery,
  ListWorkspacesQuery,
} from '../../src/index.js';

// Every list's search box shares one rule (clients/text.ts, SearchText): a NUL answered 500, since
// Postgres text cannot hold it. Now it, the other control characters and lone surrogates are 400.
const lists: [string, z.ZodType][] = [
  ['clients', ListClientsQuery],
  ['firm applications', ListFirmApplicationsQuery],
  ['firms', ListFirmsQuery],
  ['invoices', ListInvoicesQuery],
  ['my invoices', ListMyInvoicesQuery],
  ['workspaces', ListWorkspacesQuery],
];

describe('search text, the same on every list', () => {
  it.each(lists)('%s: trimmed, up to 100 characters, any language and emoji', (_, schema) => {
    const search = (value: string) =>
      (schema.parse({ search: value }) as { search?: string }).search;
    expect(search('  Sample  ')).toBe('Sample');
    expect(search('')).toBe('');
    expect(search('x'.repeat(100))).toHaveLength(100);
    for (const ok of [
      'Zoë Ñúñez',
      '株式会社',
      'نمونه',
      'Fake 😀 Co',
      '100% _Fake_',
      'a+b@x.test',
    ]) {
      expect(search(ok), ok).toBe(ok);
    }
  });

  it.each(lists)(
    '%s: a NUL, another control character or a lone surrogate is refused',
    (_, schema) => {
      const refused = (value: string) => {
        const result = schema.safeParse({ search: value });
        return result.success ? null : result.error.issues.map((i) => i.message);
      };
      for (const bad of [
        '\u0000',
        'a\u0000b',
        'Jamie\u001b[31m',
        'two\nlines',
        'a\tb',
        '\u007f',
        '\u0085',
        '\ud800',
        'a\udc00b',
        'half \ud83d emoji',
      ]) {
        expect(refused(bad), JSON.stringify(bad)).toEqual(['Remove the special characters']);
      }
      expect(refused('x'.repeat(101))).toEqual(['Use at most 100 characters']);
    },
  );
});
