import { describe, expect, it } from 'vitest';
import { withTab } from './url-tab';

// Review 2 (Payroll UX01, F05; Bookkeeping N08): the workspace tab is kept in the address.

describe('withTab', () => {
  it('sets the tab and keeps the other parameters', () => {
    expect(withTab('/payroll/clients/x', 'reports')).toBe('/payroll/clients/x?tab=reports');
    expect(withTab('/payroll/clients/x?tab=overview&from=%2Fpayroll', 'communications')).toBe(
      '/payroll/clients/x?tab=communications&from=%2Fpayroll',
    );
  });

  it('keeps the hash', () => {
    expect(withTab('/bookkeeping/clients/x?a=1#top', 'reconciliation')).toBe(
      '/bookkeeping/clients/x?a=1&tab=reconciliation#top',
    );
  });
});
