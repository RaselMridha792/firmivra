import { describe, expect, it } from 'vitest';
import { recurringHref, workspacePath } from './new-task-href';

// Review 2 (Bookkeeping N05): the recurring form keeps the client and engagement, and Related To
// opens the engagement's own workspace.

describe('recurringHref', () => {
  it('carries the client and engagement, or nothing', () => {
    expect(recurringHref('c1', 'e1')).toBe('/tasks/recurring/new?clientId=c1&engagementId=e1');
    expect(recurringHref('c1', '')).toBe('/tasks/recurring/new?clientId=c1');
    expect(recurringHref('', '')).toBe('/tasks/recurring/new');
  });
});

describe('workspacePath', () => {
  it('opens the bookkeeping, payroll or advisory workspace', () => {
    expect(workspacePath({ kind: 'BOOKKEEPING', id: 'w' })).toBe('/bookkeeping/clients/w');
    expect(workspacePath({ kind: 'PAYROLL', id: 'w' })).toBe('/payroll/clients/w');
    expect(workspacePath({ kind: 'ADVISORY', id: 'w' })).toBe('/business-advisory/clients/w');
  });

  it('is nothing for an engagement without a workspace', () => {
    expect(workspacePath(null)).toBeNull();
    expect(workspacePath(undefined)).toBeNull();
  });
});
