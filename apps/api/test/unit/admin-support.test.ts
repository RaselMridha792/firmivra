import { describe, expect, it } from 'vitest';
import type { SupportTicket } from '@firmivra/types';
import {
  addBusinessMinutes,
  businessMinutesBetween,
  clockMinutes,
  colorOf,
  COLOR_HEX,
  dueTime,
  inDays,
  rescheduledDue,
  slaOf,
  storedMinutes,
  type SupportHours,
  targetOf,
} from '../../src/admin-support/sla.js';
import {
  activityOf,
  inTab,
  matchesSearch,
} from '../../src/admin-support/support-tickets.service.js';
import type { SupportContext } from '../../src/admin-support/support-context.js';

const MIN = 60_000;
const at = (s: string) => Date.parse(s);
const weekdays = (start = '09:00', end = '17:00'): SupportHours['days'] =>
  [0, 1, 2, 3, 4, 5, 6].map((day) => ({ day, open: day >= 1 && day <= 5, start, end }));
const hours = (over: Partial<SupportHours> = {}): SupportHours => ({
  timeZone: 'America/New_York',
  days: weekdays(),
  holidays: [],
  clock: 'BUSINESS',
  ...over,
});

describe('the support clock', () => {
  it('counts open minutes only, across the evening and the weekend', () => {
    // Monday 16:00 EDT + 2 h: 1 h today, 1 h Tuesday morning.
    expect(
      new Date(addBusinessMinutes(at('2026-10-19T20:00:00Z'), 120, hours())).toISOString(),
    ).toBe('2026-10-20T14:00:00.000Z');
    // Friday 16:30 + 1 h: half an hour Friday, half an hour Monday.
    expect(
      new Date(addBusinessMinutes(at('2026-10-23T20:30:00Z'), 60, hours())).toISOString(),
    ).toBe('2026-10-26T13:30:00.000Z');
    // Before opening: the clock starts at 09:00.
    expect(
      new Date(addBusinessMinutes(at('2026-10-19T10:15:00Z'), 30, hours())).toISOString(),
    ).toBe('2026-10-19T13:30:00.000Z');
  });

  it('skips holidays and follows the time zone across the end of daylight saving time', () => {
    const withHoliday = hours({ holidays: ['2026-10-20'] });
    expect(
      new Date(addBusinessMinutes(at('2026-10-19T20:00:00Z'), 120, withHoliday)).toISOString(),
    ).toBe('2026-10-21T14:00:00.000Z');
    // Friday Oct 30 16:00 EDT + 2 h lands Monday Nov 2 10:00 EST (UTC-5).
    expect(
      new Date(addBusinessMinutes(at('2026-10-30T20:00:00Z'), 120, hours())).toISOString(),
    ).toBe('2026-11-02T15:00:00.000Z');
  });

  it('measures open minutes between two moments, either way round', () => {
    const h = hours();
    expect(businessMinutesBetween(at('2026-10-19T20:00:00Z'), at('2026-10-20T14:00:00Z'), h)).toBe(
      120,
    );
    expect(businessMinutesBetween(at('2026-10-20T14:00:00Z'), at('2026-10-19T20:00:00Z'), h)).toBe(
      -120,
    );
    expect(businessMinutesBetween(at('2026-10-24T14:00:00Z'), at('2026-10-25T20:00:00Z'), h)).toBe(
      0,
    );
  });

  it('stores targets in minutes, a business day being 480, and runs them on the open day', () => {
    expect(targetOf(480)).toEqual({ amount: 1, unit: 'BUSINESS_DAYS' });
    expect(targetOf(960)).toEqual({ amount: 2, unit: 'BUSINESS_DAYS' });
    expect(targetOf(240)).toEqual({ amount: 4, unit: 'HOURS' });
    expect(targetOf(60)).toEqual({ amount: 1, unit: 'HOURS' });
    expect(storedMinutes({ amount: 2, unit: 'BUSINESS_DAYS' })).toBe(960);
    expect(storedMinutes({ amount: 3, unit: 'HOURS' })).toBe(180);
    // A 08:00-18:00 day makes a business day 10 hours; hours stay hours.
    expect(clockMinutes(480, hours({ days: weekdays('08:00', '18:00') }))).toBe(600);
    expect(clockMinutes(240, hours({ days: weekdays('08:00', '18:00') }))).toBe(240);
    expect(clockMinutes(480, hours({ clock: 'CALENDAR' }))).toBe(24 * 60);
    expect(dueTime(at('2026-10-19T20:00:00Z'), 60, hours({ clock: 'CALENDAR' }))).toBe(
      at('2026-10-19T21:00:00Z'),
    );
  });

  it('works out the SLA state', () => {
    const h = hours();
    const now = at('2026-10-19T14:00:00Z');
    const facts = {
      status: 'OPEN' as const,
      breached: false,
      targetMinutes: 240,
      pauseWhileWaiting: true,
    };
    expect(slaOf({ ...facts, dueAt: new Date(now + 180 * MIN) }, h, now)).toEqual({
      state: 'WITHIN',
      dueAt: new Date(now + 180 * MIN).toISOString(),
      minutesLeft: 180,
    });
    expect(slaOf({ ...facts, dueAt: new Date(now + 50 * MIN) }, h, now).state).toBe('WARNING');
    expect(slaOf({ ...facts, dueAt: new Date(now - MIN) }, h, now)).toMatchObject({
      state: 'BREACHED',
      minutesLeft: -1,
    });
    expect(slaOf({ ...facts, status: 'WAITING_ON_CUSTOMER', dueAt: null }, h, now).state).toBe(
      'PAUSED',
    );
    expect(slaOf({ ...facts, status: 'RESOLVED', dueAt: null }, h, now).state).toBe('MET');
    expect(slaOf({ ...facts, status: 'CLOSED', dueAt: null, breached: true }, h, now).state).toBe(
      'BREACHED',
    );
    expect(slaOf({ ...facts, dueAt: null }, h, now)).toEqual({
      state: 'WITHIN',
      dueAt: null,
      minutesLeft: null,
    });
  });

  it('counts the time already used against a new priority', () => {
    const h = hours();
    const now = at('2026-10-19T14:00:00Z');
    // 4 h target, 30 min used (due in 3.5 h); the new target is 1 h: due in 30 min.
    expect(rescheduledDue(now, now + 210 * MIN, 240, 60, h)).toBe(now + 30 * MIN);
    // 4 h target, 250 min used (10 min past due); a 1 h target leaves it past due.
    expect(rescheduledDue(now, now - 10 * MIN, 240, 60, h)).toBeLessThanOrEqual(now);
    // 1 h target, 70 min used; a 4 h target leaves 170 min.
    expect(rescheduledDue(now, now - 10 * MIN, 60, 240, h)).toBe(now + 170 * MIN);
  });

  it('maps stored colours to tokens and days to the support zone', () => {
    expect(colorOf('#dc2626')).toBe('red');
    expect(colorOf('#2563EB')).toBe('blue');
    expect(colorOf('#123456')).toBe('grey');
    expect(colorOf(COLOR_HEX.purple)).toBe('purple');
    // 02:00 UTC on the 20th is still the 19th in New York.
    expect(inDays(at('2026-10-20T02:00:00Z'), 'America/New_York', '2026-10-19', '2026-10-19')).toBe(
      true,
    );
    expect(inDays(at('2026-10-20T02:00:00Z'), 'America/New_York', '2026-10-20')).toBe(false);
  });
});

describe('the ticket list', () => {
  const me = '0199c1a0-0000-7000-8000-0000000000a1';
  const ctx = {
    me: { id: me },
    escalation: [],
    priorities: [
      { id: 'p1', rank: 1 },
      { id: 'p2', rank: 2 },
      { id: 'p3', rank: 3 },
    ],
  } as unknown as SupportContext;
  const ticket = (over: Partial<SupportTicket> = {}): SupportTicket => ({
    id: 't1',
    number: 1001,
    subject: 'Cannot upload a W-2',
    status: 'OPEN',
    source: 'EMAIL',
    priority: { id: 'p3', name: 'Medium', color: 'yellow', rank: 3, active: true },
    category: { id: 'c1', name: 'Document Filing', active: true },
    firm: { id: 'f1', name: 'Sample Tax Partners' },
    contact: { id: 'u1', name: 'Avery Example', email: 'avery@example.test', phone: '' },
    assignee: null,
    createdBy: { name: 'Avery Example', role: 'CLIENT' },
    createdAt: '2026-10-19T14:00:00.000Z',
    updatedAt: '2026-10-19T14:00:00.000Z',
    firstResponseAt: null,
    resolvedAt: null,
    closedAt: null,
    sla: { state: 'WITHIN', dueAt: null, minutesLeft: null },
    escalation: null,
    mergedInto: null,
    counts: { messages: 1, attachments: 0, notes: 0 },
    version: 1,
    ...over,
  });

  it('puts tickets in their tabs', () => {
    expect(inTab(ticket(), 'UNASSIGNED', ctx)).toBe(true);
    expect(inTab(ticket({ assignee: { id: me, name: 'Me', active: true } }), 'MINE', ctx)).toBe(
      true,
    );
    expect(inTab(ticket(), 'HIGH_PRIORITY', ctx)).toBe(false);
    expect(
      inTab(
        ticket({ priority: { id: 'p2', name: 'High', color: 'orange', rank: 2, active: true } }),
        'HIGH_PRIORITY',
        ctx,
      ),
    ).toBe(true);
    expect(
      inTab(ticket({ sla: { state: 'BREACHED', dueAt: null, minutesLeft: -5 } }), 'OVERDUE', ctx),
    ).toBe(true);
    expect(
      inTab(
        ticket({ status: 'CLOSED', sla: { state: 'BREACHED', dueAt: null, minutesLeft: null } }),
        'OVERDUE',
        ctx,
      ),
    ).toBe(false);
    expect(
      inTab(
        ticket({ escalation: { reason: 'x', at: '2026-10-19T14:00:00.000Z', by: 'System' } }),
        'ESCALATED',
        ctx,
      ),
    ).toBe(true);
    expect(inTab(ticket({ status: 'WAITING_ON_CUSTOMER' }), 'WAITING', ctx)).toBe(true);
    expect(inTab(ticket({ status: 'CLOSED' }), 'CLOSED', ctx)).toBe(true);
  });

  it('searches the number, subject, firm, contact, category and assignee', () => {
    expect(matchesSearch(ticket(), '#1001')).toBe(true);
    expect(matchesSearch(ticket({ number: 7 }), '0007')).toBe(true);
    expect(matchesSearch(ticket(), 'w-2 sample')).toBe(true);
    expect(matchesSearch(ticket(), 'avery@example')).toBe(true);
    expect(matchesSearch(ticket(), 'unassigned filing')).toBe(true);
    expect(matchesSearch(ticket(), 'payroll')).toBe(false);
  });

  it('turns history rows into the activity feed', () => {
    const nameOf = (id: string | null) => (id ? 'Jordan Admin' : 'System');
    const row = (action: string, over: Record<string, unknown> = {}) => ({
      id: 'e1',
      action,
      actorType: 'USER',
      actorUserId: me,
      oldValue: null,
      newValue: null,
      createdAt: new Date('2026-10-19T14:00:00.000Z'),
      ...over,
    });
    expect(
      activityOf(row('ticket.created', { newValue: 'OPEN' }), 'EMAIL', { nameOf }),
    ).toMatchObject({
      type: 'CREATED',
      actor: 'Jordan Admin',
      note: 'Created from Email',
    });
    expect(
      activityOf(
        row('ticket.status_changed', { oldValue: 'OPEN', newValue: 'WAITING_ON_CUSTOMER' }),
        'PORTAL',
        { nameOf },
      ),
    ).toMatchObject({ type: 'STATUS_CHANGED', from: 'Open', to: 'Waiting on Customer' });
    expect(
      activityOf(
        row('ticket.assigned', { actorType: 'SYSTEM', actorUserId: null, newValue: 'Riley Agent' }),
        'PHONE',
        { nameOf },
      ),
    ).toMatchObject({ type: 'ASSIGNED', actor: 'System', to: 'Riley Agent', note: 'Round robin' });
    expect(activityOf(row('message.added', { newValue: 'KEPT' }), 'PHONE', { nameOf }).note).toBe(
      'Kept in the conversation',
    );
    expect(
      activityOf(row('sla.breached', { actorType: 'SYSTEM', actorUserId: null }), 'PHONE', {
        nameOf,
      }).type,
    ).toBe('SLA_BREACHED');
  });
});
