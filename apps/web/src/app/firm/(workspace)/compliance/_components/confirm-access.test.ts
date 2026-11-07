import { describe, expect, it } from 'vitest';
import { confirmAccess } from './confirm-access';

describe('Confirm Filing on a record page: who sees it and who may confirm (AU-F31)', () => {
  it('lets an Owner or Admin see and confirm on a payroll run and a deadline', () => {
    for (const role of ['OWNER', 'ADMIN'] as const) {
      expect(confirmAccess(role, 'PAYROLL')).toEqual({ sees: true, may: true });
      expect(confirmAccess(role, 'COMPLIANCE')).toEqual({ sees: true, may: true });
    }
  });

  it('keeps Staff out: the Automations area is not theirs', () => {
    expect(confirmAccess('STAFF', 'PAYROLL')).toEqual({ sees: false, may: false });
  });

  it('shows a Manager the confirmation without letting them record one', () => {
    expect(confirmAccess('MANAGER', 'COMPLIANCE')).toEqual({ sees: true, may: false });
  });

  it('gives a role without the Automations area nothing, and nothing before the role loads', () => {
    expect(confirmAccess('READ_ONLY', 'PAYROLL')).toEqual({ sees: false, may: false });
    expect(confirmAccess('BOOKKEEPER', 'PAYROLL')).toEqual({ sees: false, may: false });
    expect(confirmAccess(undefined, 'PAYROLL')).toEqual({ sees: false, may: false });
  });
});
