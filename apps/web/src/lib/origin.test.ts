import { describe, expect, it } from 'vitest';
import { mergeListQuery, pageOf, readListQuery } from './list-query';
import { originLabel, safeOrigin, withOrigin } from './origin';

describe('safeOrigin (SH1)', () => {
  it('keeps a path on this site with its query', () => {
    expect(safeOrigin('/payroll?tab=PAST_DUE&q=Fake')).toBe('/payroll?tab=PAST_DUE&q=Fake');
    expect(
      safeOrigin('/bookkeeping/clients/0199c0f0-9c00-7000-8000-000000000001?tab=Reports'),
    ).toBe('/bookkeeping/clients/0199c0f0-9c00-7000-8000-000000000001?tab=Reports');
  });

  it('never follows another host, a scheme or a broken value', () => {
    for (const bad of [
      'https://evil.example/payroll',
      '//evil.example/x',
      '/\\evil.example',
      'javascript:alert(1)',
      'payroll',
      '/pay\nroll',
      `/${'x'.repeat(2001)}`,
      null,
      42,
    ]) {
      expect(safeOrigin(bad)).toBeNull();
    }
  });
});

describe('withOrigin', () => {
  it('adds from= and keeps the link’s own query and hash', () => {
    expect(withOrigin('/tasks/new', '/payroll?tab=ALL')).toBe(
      '/tasks/new?from=%2Fpayroll%3Ftab%3DALL',
    );
    expect(withOrigin('/documents?clientId=abc#top', '/bookkeeping')).toBe(
      '/documents?clientId=abc&from=%2Fbookkeeping#top',
    );
    expect(withOrigin('/tasks/new', 'https://evil.example')).toBe('/tasks/new');
  });

  it('names the place', () => {
    expect(originLabel('/payroll/clients/x?tab=runs')).toBe('Payroll');
    expect(originLabel('/bookkeeping')).toBe('Bookkeeping');
    expect(originLabel('/tax-returns/x')).toBe('Tax Returns');
    expect(originLabel('/somewhere-else')).toBe('Previous Page');
  });
});

describe('the list view in the address', () => {
  const defaults = { period: 'THIS_MONTH', tab: 'ALL', q: '', page: '1' };

  it('reads each key it knows, as text, and nothing else', () => {
    expect(
      readListQuery({ tab: 'PAST_DUE', q: 'Fake', page: ['2', '3'], other: 'x' }, defaults),
    ).toEqual({ period: 'THIS_MONTH', tab: 'PAST_DUE', q: 'Fake', page: '1' });
  });

  it('writes only what differs from the defaults and keeps other parameters', () => {
    expect(
      mergeListQuery('?from=%2Fx&tab=OLD', { ...defaults, tab: 'ON_TRACK', q: 'Fake' }, defaults),
    ).toBe('?from=%2Fx&tab=ON_TRACK&q=Fake');
    expect(mergeListQuery('?tab=OLD', defaults, defaults)).toBe('');
  });

  it('reads a page number only when it is one', () => {
    expect(pageOf('3')).toBe(3);
    expect(pageOf('0')).toBe(1);
    expect(pageOf('x', 10)).toBe(10);
  });
});
