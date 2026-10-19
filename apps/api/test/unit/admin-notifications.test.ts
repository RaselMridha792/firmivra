// The Super Admin notification center's rules (R56 on R0's B1): which action applies to which
// item, how the five statuses and the filters become a query, and "today" in US Eastern time.
import { describe, expect, it } from 'vitest';
import {
  actionPatch,
  AUDITED_CATEGORIES,
  filtersWhere,
  startOfDayIn,
  statusWhere,
  type ItemState,
} from '../../src/admin-notifications/admin-notifications.rules.js';

const ME = '0199c1a0-0000-7000-8000-0000000000ff';
const NOW = new Date('2026-10-19T12:00:00.000Z');
const open = (patch: Partial<ItemState> = {}): ItemState => ({
  readAt: null,
  requiresAction: true,
  attention: 'ACTION_REQUIRED',
  ...patch,
});

describe('actionPatch', () => {
  it('reads an unread item and leaves a read one as it is', () => {
    expect(actionPatch(open(), 'READ', ME, NOW)).toEqual({ data: { readAt: NOW } });
    expect(actionPatch(open({ readAt: NOW }), 'READ', ME, NOW)).toEqual({ data: null });
  });

  it('marks a read item unread, also once it is closed', () => {
    expect(actionPatch(open({ readAt: NOW }), 'UNREAD', ME)).toEqual({ data: { readAt: null } });
    expect(actionPatch(open({ readAt: NOW, attention: 'RESOLVED' }), 'UNREAD', ME)).toEqual({
      data: { readAt: null },
    });
    expect(actionPatch(open(), 'UNREAD', ME)).toEqual({ data: null });
  });

  it('resolves only items that ask for work, recording who', () => {
    expect(actionPatch(open(), 'RESOLVE', ME)).toEqual({
      data: { attention: 'RESOLVED', resolvedByUserId: ME },
    });
    expect(actionPatch(open({ requiresAction: false, attention: 'NONE' }), 'RESOLVE', ME)).toEqual({
      error: 'NOT_ACTIONABLE',
    });
  });

  it('dismisses any open item', () => {
    expect(actionPatch(open({ requiresAction: false, attention: 'NONE' }), 'DISMISS', ME)).toEqual({
      data: { attention: 'DISMISSED' },
    });
  });

  it('keeps resolved and dismissed final', () => {
    for (const attention of ['RESOLVED', 'DISMISSED'] as const)
      for (const action of ['RESOLVE', 'DISMISS'] as const)
        expect(actionPatch(open({ attention }), action, ME)).toEqual({ error: 'ALREADY_CLOSED' });
  });
});

describe('statusWhere and filtersWhere', () => {
  it('maps the five statuses to the read state or the attention', () => {
    expect(statusWhere('UNREAD')).toEqual({ readAt: null });
    expect(statusWhere('READ')).toEqual({ readAt: { not: null } });
    expect(statusWhere('ACTION_REQUIRED')).toEqual({ attention: 'ACTION_REQUIRED' });
    expect(statusWhere('RESOLVED')).toEqual({ attention: 'RESOLVED' });
    expect(statusWhere('DISMISSED')).toEqual({ attention: 'DISMISSED' });
  });

  it('always keeps to the member and adds only the filters given', () => {
    expect(filtersWhere(ME, {})).toEqual({ AND: [{ recipientUserId: ME }] });
    const where = filtersWhere(ME, {
      category: 'SECURITY',
      priority: 'CRITICAL',
      from: '2026-10-01T00:00:00.000Z',
      to: '2026-10-19T00:00:00.000Z',
      search: 'login',
    });
    expect(where.AND).toEqual([
      { recipientUserId: ME },
      { category: 'SECURITY' },
      { priority: 'CRITICAL' },
      {
        occurredAt: {
          gte: new Date('2026-10-01T00:00:00.000Z'),
          lt: new Date('2026-10-19T00:00:00.000Z'),
        },
      },
      {
        OR: [
          { title: { contains: 'login', mode: 'insensitive' } },
          { body: { contains: 'login', mode: 'insensitive' } },
          { sourceLabel: { contains: 'login', mode: 'insensitive' } },
        ],
      },
    ]);
  });
});

describe('startOfDayIn', () => {
  it('is midnight in New York, summer and winter', () => {
    expect(startOfDayIn('America/New_York', NOW).toISOString()).toBe('2026-10-19T04:00:00.000Z');
    expect(
      startOfDayIn('America/New_York', new Date('2026-12-02T03:00:00.000Z')).toISOString(),
    ).toBe('2026-12-01T05:00:00.000Z');
  });
});

it('audits resolving and dismissing security and billing items only', () => {
  expect([...AUDITED_CATEGORIES].sort()).toEqual(['BILLING_SUBSCRIPTIONS', 'SECURITY']);
});
