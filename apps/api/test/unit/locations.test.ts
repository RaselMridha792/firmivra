// Settings > Locations' rules without a database (R1): who runs a location (its manager or the
// main location's acting), the plan's allowance and the KPI cards, now-or-later, what a due
// scheduled change does, the Super Administrator, the job's switch, and the activity rows' words.
import { describe, expect, it } from 'vitest';
import { LOCATION_DUPLICATE_MESSAGE } from '@firmivra/types';
import { locationJobsOn } from '../../src/locations/location-actions.job.js';
import {
  allowanceOf,
  decide,
  type GridReader,
  isSuperAdministrator,
  kpisOf,
  mapLocationDbError,
  MAX_SCHEDULE_MS,
  overAllowance,
  runnerOf,
  whenOf,
} from '../../src/locations/locations-common.js';
import { activityItem } from '../../src/settings/admin-activity.js';
import { monthStartOf } from '../../src/settings/settings-overview.service.js';

const OWN = '0190a0a0-0000-7000-8000-000000000001';
const MAIN = '0190a0a0-0000-7000-8000-000000000002';

describe('runnerOf: who runs a location', () => {
  it('is the location’s own manager while they work at the firm', () => {
    expect(runnerOf({ userId: OWN, present: true }, { userId: MAIN, present: true })).toEqual({
      userId: OWN,
      acting: false,
    });
  });

  it('is the main location’s manager, acting, without one or once theirs is deactivated', () => {
    const main = { userId: MAIN, present: true };
    expect(runnerOf(null, main)).toEqual({ userId: MAIN, acting: true });
    expect(runnerOf({ userId: OWN, present: false }, main)).toEqual({ userId: MAIN, acting: true });
  });

  it('is nobody when neither is there', () => {
    expect(runnerOf(null, null)).toBeNull();
    expect(runnerOf({ userId: OWN, present: false }, { userId: MAIN, present: false })).toBeNull();
  });
});

describe('the plan’s allowance and the KPI cards', () => {
  it('allows included plus purchased locations, and sets no limit without a subscription', () => {
    expect(allowanceOf({ locationsIncluded: 1, locationsPurchased: 2 })).toBe(3);
    expect(allowanceOf(null)).toBeNull();
  });

  it('refuses one more ACTIVE location only past the allowance', () => {
    expect(overAllowance(2, 3)).toBe(false);
    expect(overAllowance(3, 3)).toBe(true);
    expect(overAllowance(500, null)).toBe(false);
  });

  it('counts used as the ACTIVE locations', () => {
    expect(kpisOf({ total: 4, active: 2 }, 5)).toEqual({
      total: 4,
      active: 2,
      subscription: { used: 2, allowed: 5 },
    });
    expect(kpisOf({ total: 0, active: 0 }, null).subscription).toEqual({ used: 0, allowed: null });
  });
});

describe('whenOf: now or later', () => {
  const now = Date.parse('2026-10-21T12:00:00.000Z');
  it('is now when left out or not in the future', () => {
    expect(whenOf(undefined, now)).toEqual({ now: true });
    expect(whenOf('2026-10-21T12:00:00.000Z', now)).toEqual({ now: true });
    expect(whenOf('2026-10-20T09:00:00-04:00', now)).toEqual({ now: true });
  });

  it('is later up to a year ahead, and refuses more (400)', () => {
    expect(whenOf('2026-11-01T09:00:00.000Z', now)).toEqual({
      at: new Date('2026-11-01T09:00:00.000Z'),
    });
    expect(() => whenOf(new Date(now + MAX_SCHEDULE_MS + 60_000).toISOString(), now)).toThrow();
  });
});

describe('decide: what a due scheduled change does', () => {
  const live = { live: true, isMain: false };
  it('deactivates a location, but never the main one or one archived since', () => {
    expect(decide({ kind: 'DEACTIVATE_LOCATION', office: live })).toEqual({ outcome: 'DONE' });
    expect(decide({ kind: 'DEACTIVATE_LOCATION', office: { live: true, isMain: true } })).toEqual({
      outcome: 'FAILED',
      code: 'LOCATION_IS_PRIMARY',
    });
    expect(decide({ kind: 'DEACTIVATE_LOCATION', office: { live: false, isMain: false } })).toEqual(
      { outcome: 'FAILED', code: 'LOCATION_ARCHIVED' },
    );
  });

  it('reassigns only to a new manager who is still ACTIVE', () => {
    expect(decide({ kind: 'REASSIGN_MANAGER', office: live, newManagerActive: true })).toEqual({
      outcome: 'DONE',
    });
    expect(decide({ kind: 'REASSIGN_MANAGER', office: live, newManagerActive: false })).toEqual({
      outcome: 'FAILED',
      code: 'NEW_MANAGER_INACTIVE',
    });
    // The main location may get a new manager.
    expect(
      decide({
        kind: 'REASSIGN_MANAGER',
        office: { live: true, isMain: true },
        newManagerActive: true,
      }),
    ).toEqual({ outcome: 'DONE' });
  });

  it('deactivates a manager with an active replacement, or none (the acting fallback)', () => {
    expect(
      decide({ kind: 'DEACTIVATE_MANAGER', managerAllowed: true, newManagerActive: null }),
    ).toEqual({
      outcome: 'DONE',
    });
    expect(
      decide({ kind: 'DEACTIVATE_MANAGER', managerAllowed: true, newManagerActive: true }),
    ).toEqual({
      outcome: 'DONE',
    });
    expect(
      decide({ kind: 'DEACTIVATE_MANAGER', managerAllowed: true, newManagerActive: false }),
    ).toEqual({ outcome: 'FAILED', code: 'NEW_MANAGER_INACTIVE' });
    expect(decide({ kind: 'DEACTIVATE_MANAGER', managerAllowed: false })).toEqual({
      outcome: 'FAILED',
      code: 'MANAGER_NOT_ALLOWED',
    });
  });
});

describe('isSuperAdministrator', () => {
  const grid = (member: boolean | undefined, admin: boolean): GridReader & { asked: string[] } => {
    const asked: string[] = [];
    return {
      asked,
      memberCell: (_b, _u, module, capability) => {
        asked.push(`member:${module}:${capability}`);
        return Promise.resolve(member);
      },
      can: (_b, role, module, capability) => {
        asked.push(`${role}:${module}:${capability}`);
        return Promise.resolve(admin);
      },
    };
  };
  const viewer = (role: string) => ({ businessId: MAIN, userId: OWN, role });

  it('is always the Owner, and never a role below Admin', async () => {
    expect(await isSuperAdministrator(grid(false, false), viewer('OWNER'))).toBe(true);
    for (const role of ['STAFF', 'MANAGER', 'READ_ONLY', 'CLIENT'])
      expect(await isSuperAdministrator(grid(true, true), viewer(role))).toBe(false);
  });

  it('is an Admin by their own SETTINGS MANAGE cell first, then the firm’s Admin grid', async () => {
    const own = grid(false, true);
    expect(await isSuperAdministrator(own, viewer('ADMIN'))).toBe(false);
    expect(own.asked).toEqual(['member:SETTINGS:MANAGE']);
    expect(await isSuperAdministrator(grid(true, false), viewer('ADMIN'))).toBe(true);
    const role = grid(undefined, false);
    expect(await isSuperAdministrator(role, viewer('ADMIN'))).toBe(false);
    expect(role.asked).toEqual(['member:SETTINGS:MANAGE', 'ADMIN:SETTINGS:MANAGE']);
    expect(await isSuperAdministrator(grid(undefined, true), viewer('ADMIN'))).toBe(true);
  });
});

describe('locationJobsOn', () => {
  it('runs unless LOCATION_JOBS=off, and not in tests unless LOCATION_JOBS=on', () => {
    expect(locationJobsOn({ NODE_ENV: 'production' })).toBe(true);
    expect(locationJobsOn({ NODE_ENV: 'production', LOCATION_JOBS: 'off' })).toBe(false);
    expect(locationJobsOn({ NODE_ENV: 'test' })).toBe(false);
    expect(locationJobsOn({ NODE_ENV: 'test', LOCATION_JOBS: 'on' })).toBe(true);
    expect(() => locationJobsOn({ NODE_ENV: 'production', LOCATION_JOBS: 'yes' })).toThrow(
      'LOCATION_JOBS',
    );
  });
});

describe('mapLocationDbError', () => {
  const dbError = (code: string, message: string, index?: string) => ({
    meta: {
      driverAdapterError: {
        cause: {
          originalCode: code,
          originalMessage: message,
          constraint: index ? { index } : undefined,
        },
      },
    },
  });
  const codeOf = (e: unknown) =>
    (e as { getResponse?: () => { code?: string; message?: string } }).getResponse?.();

  it('turns the live name or address into the duplicate message', () => {
    for (const index of ['firm_offices_live_address', 'firm_offices_live_name'])
      expect(codeOf(mapLocationDbError(dbError('23505', 'duplicate key', index)))).toEqual({
        code: 'DUPLICATE_LOCATION',
        message: LOCATION_DUPLICATE_MESSAGE,
      });
  });

  it('turns the one-pending indexes, a finished action and any CHECK into the contract’s codes', () => {
    expect(
      codeOf(
        mapLocationDbError(dbError('23505', 'x', 'firm_office_actions_one_pending_per_office')),
      )?.code,
    ).toBe('PENDING_ACTION_EXISTS');
    expect(
      codeOf(
        mapLocationDbError(
          dbError('23514', 'firm office actions: a finished action never changes'),
        ),
      )?.code,
    ).toBe('ACTION_FINISHED');
    expect(
      codeOf(
        mapLocationDbError(dbError('23514', 'violates check constraint "firm_offices_contact"')),
      )?.code,
    ).toBe('VALIDATION_FAILED');
    const other = new Error('boom');
    expect(mapLocationDbError(other)).toBe(other);
  });
});

describe('activity rows', () => {
  const row = (action: string, metadata: object = {}, entityType = 'firm_office') => ({
    id: '0190a0a0-0000-7000-8000-0000000000aa',
    createdAt: new Date('2026-10-21T10:00:00.000Z'),
    action,
    entityType,
    entityId: OWN,
    metadata,
  });
  const names = new Map([[OWN, 'Fake Auburn Office']]);

  it('says what happened in the screen’s words, with the location’s name', () => {
    expect(activityItem(row('firm_office.created'), names)).toEqual({
      id: '0190a0a0-0000-7000-8000-0000000000aa',
      at: '2026-10-21T10:00:00.000Z',
      action: 'firm_office.created',
      label: 'Location added - Fake Auburn Office',
      tone: 'success',
    });
    expect(activityItem(row('firm_office.manager_reassigned', { acting: true }), names).label).toBe(
      'Main location manager acting - Fake Auburn Office',
    );
    const scheduled = activityItem(
      row(
        'firm_office_action.scheduled',
        { kind: 'DEACTIVATE_LOCATION', officeId: OWN },
        'firm_office_action',
      ),
      names,
    );
    expect(scheduled).toMatchObject({
      label: 'Location deactivation scheduled - Fake Auburn Office',
      tone: 'info',
    });
  });

  it('names an action it does not know plainly, with a tone from its verb', () => {
    expect(activityItem(row('payroll.run_created', {}, 'payroll'))).toMatchObject({
      label: 'Payroll run created',
      tone: 'success',
    });
  });
});

describe('monthStartOf', () => {
  it('is the first of the month on the firm’s clock', () => {
    // 01:30 UTC on Nov 1 is still Oct 31 in New York.
    const at = Date.parse('2026-11-01T01:30:00.000Z');
    expect(monthStartOf('America/New_York', at).toISOString()).toBe('2026-10-01T04:00:00.000Z');
    expect(monthStartOf('UTC', at).toISOString()).toBe('2026-11-01T00:00:00.000Z');
  });
});
