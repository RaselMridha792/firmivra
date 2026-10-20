import { describe, expect, it } from 'vitest';
import {
  adminSubscriptionsExportPath,
  ApiRequestError,
  createAdminSubscriptionsClient,
  createRequest,
  previewSubscriptionChange,
  SUBSCRIPTION_ERRORS,
  SUBSCRIPTION_EVENT_CATEGORY,
  subscriptionAddDays,
  subscriptionAddMonths,
  subscriptionBillingDateCents,
  subscriptionDaysBetween,
  SubscriptionErrorCode,
  type SubscriptionEvent,
  subscriptionEventText,
  subscriptionMonthlyCents,
  type SubscriptionPlan,
  subscriptionPriceCents,
  subscriptionProration,
  SubscriptionRecord,
  type SubscriptionRow,
  SubscriptionsQuery,
  subscriptionSeatRange,
  SubscriptionStatusFilter,
} from '../../src/index.js';

function fakeFetch(status: number, body: unknown) {
  const calls: { url: string; method: string; body: unknown }[] = [];
  const fn = (async (url: string, init: RequestInit) => {
    calls.push({
      url,
      method: init.method ?? 'GET',
      body: init.body === undefined ? undefined : JSON.parse(init.body as string),
    });
    return new Response(JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json' },
    });
  }) as unknown as typeof fetch;
  return { fn, calls };
}

const id = (n: number) => `0199d755-0000-7000-8000-${String(n).padStart(12, '0')}`;
const at = '2026-10-20T09:00:00.000Z';
const client = (fn: typeof fetch) =>
  createAdminSubscriptionsClient(createRequest({ baseUrl: '/api/v1', fetch: fn }));
const path = (call: { method: string; url: string }) =>
  `${call.method} ${call.url.replace('/api/v1/admin/subscriptions', '')}`;

/** A synthetic subscription row as the API answers it. */
const row = (): SubscriptionRow => ({
  id: id(1),
  firm: {
    id: id(2),
    name: 'Sample Blue Ridge Tax',
    slug: 'sample-blue-ridge',
    status: 'ACTIVE',
    email: 'billing@blueridge.example.test',
    domain: 'blueridge.example.test',
  },
  plan: { id: id(3), code: 'TEAM_PRO', name: 'Team Pro' },
  billingCycle: 'MONTHLY',
  status: 'ACTIVE',
  seatsIncluded: 3,
  extraSeats: 2,
  seatsAllowed: 5,
  seatsUsed: 4,
  usagePercent: 80,
  locationsIncluded: 1,
  extraLocations: 0,
  locationsAllowed: 1,
  listPriceCents: 25_700,
  baseOverrideCents: 15_000,
  priceCents: 20_800,
  monthlyCents: 20_800,
  creditCents: 0,
  autoRenew: true,
  nextBillingOn: '2026-11-05',
  accessEndsOn: null,
  trialEndsOn: null,
  supportAccessUntil: null,
  createdAt: at,
  updatedAt: at,
});

const record = (): SubscriptionRecord => ({
  ...row(),
  today: '2026-10-20',
  startedOn: '2026-03-05',
  currentPeriodStart: '2026-10-05',
  currentPeriodEnd: '2026-11-05',
  paidThroughOn: '2026-11-05',
  trial: null,
  cancellation: null,
  suspension: null,
  closure: null,
  pastDue: null,
  accountOwner: null,
  amountDueCents: 0,
  invoices: [],
  payments: [],
  events: [],
  notes: [],
});

const result = () => ({ subscription: row(), invoice: null, creditNote: null });

const plan = (patch: Partial<SubscriptionPlan>): SubscriptionPlan => ({
  id: id(3),
  code: 'TEAM_PRO',
  name: 'Team Pro',
  priceCents: 19_900,
  billingCycle: 'MONTHLY',
  includedSeats: 3,
  maxSeats: 10,
  seatPriceCents: 2_900,
  includedLocations: 1,
  locationPriceCents: null,
  displayOrder: 3,
  active: true,
  features: [],
  ...patch,
});
const TEAM_PRO = plan({});
const BUSINESS = plan({
  id: id(4),
  code: 'BUSINESS',
  name: 'Business',
  priceCents: 49_900,
  includedSeats: 10,
  maxSeats: 20,
  seatPriceCents: 2_500,
  displayOrder: 4,
});
const ENTERPRISE = plan({
  id: id(5),
  code: 'ENTERPRISE',
  name: 'Enterprise',
  priceCents: 79_900,
  includedSeats: 20,
  maxSeats: null,
  seatPriceCents: null,
  includedLocations: 3,
  locationPriceCents: 14_900,
  displayOrder: 5,
});
const SOLO_PRO = plan({
  id: id(6),
  code: 'SOLO_PRO',
  name: 'Solo Pro',
  priceCents: 9_900,
  includedSeats: 1,
  maxSeats: 1,
  seatPriceCents: null,
  displayOrder: 1,
});

const event = (patch: Partial<SubscriptionEvent>): SubscriptionEvent => ({
  id: id(40),
  source: 'CHANGE',
  action: 'STATUS_CHANGED',
  at,
  actor: { kind: 'USER', name: 'Morgan Admin' },
  fromPlan: null,
  toPlan: null,
  fromStatus: null,
  toStatus: null,
  fromSeats: null,
  toSeats: null,
  fromLocations: null,
  toLocations: null,
  fromDay: null,
  toDay: null,
  fromCents: null,
  toCents: null,
  reason: null,
  approvedBy: null,
  amountCents: null,
  mrrCents: null,
  ...patch,
});

describe('admin subscriptions client', () => {
  it('sends the table filters, sort and page as a query string', async () => {
    const { fn, calls } = fakeFetch(200, {
      items: [row()],
      total: 1,
      all: 24,
      page: 2,
      pageSize: 24,
    });
    const page = await client(fn).subscriptions({
      search: '  blue ridge ',
      planId: id(3),
      status: 'RENEWING_SOON',
      billingCycle: 'ANNUAL',
      from: '2026-10-01',
      to: '2026-10-31',
      sort: 'NEXT_BILLING',
      dir: 'desc',
      page: 2,
      pageSize: 24,
    });
    expect(page.items[0]?.firm.name).toBe('Sample Blue Ridge Tax');
    expect(page.all).toBe(24);
    const url = new URL(calls[0]!.url, 'http://x');
    expect(calls[0]!.method).toBe('GET');
    expect(url.pathname).toBe('/api/v1/admin/subscriptions');
    const sent: Record<string, string> = {};
    url.searchParams.forEach((value, key) => (sent[key] = value));
    expect(sent).toEqual({
      search: 'blue ridge',
      planId: id(3),
      status: 'RENEWING_SOON',
      billingCycle: 'ANNUAL',
      from: '2026-10-01',
      to: '2026-10-31',
      sort: 'NEXT_BILLING',
      dir: 'desc',
      page: '2',
      pageSize: '24',
    });
    await client(fn).subscriptions();
    expect(calls[1]!.url).toBe('/api/v1/admin/subscriptions');
  });

  it('reads the query string back and refuses bad filters (the API parses the same schema)', async () => {
    const parsed = SubscriptionsQuery.parse({ page: '3', pageSize: '100', status: 'PAYING' });
    expect(parsed).toEqual({ page: 3, pageSize: 100, status: 'PAYING' });
    const bad = (query: Record<string, unknown>) => SubscriptionsQuery.safeParse(query).success;
    expect(bad({ from: '2026-10-01' })).toBe(false);
    expect(bad({ from: '2026-10-31', to: '2026-10-01' })).toBe(false);
    expect(bad({ status: 'CLOSED' })).toBe(false);
    expect(bad({ status: 'ENDED' })).toBe(false);
    expect(bad({ pageSize: '101' })).toBe(false);
    expect(bad({ plan: 'SOLO_CORE' })).toBe(false);
    expect(bad({ planId: 'SOLO_CORE' })).toBe(false);
    expect(bad({ search: 'x'.repeat(101) })).toBe(false);
    expect(SubscriptionStatusFilter.options).toContain('CANCELLED');

    const { fn, calls } = fakeFetch(200, {});
    await expect(
      client(fn).subscriptions({ from: '2026-10-01', to: '2026-09-30' }),
    ).rejects.toMatchObject({
      status: 400,
      code: 'VALIDATION_FAILED',
      message: 'The start date must be on or before the end date.',
    });
    expect(calls).toHaveLength(0);
  });

  it('reads the meta, the cards, the available firms and a record from their own paths', async () => {
    const { fn, calls } = fakeFetch(200, { items: [] });
    const api = client(fn);
    await api.meta().catch(() => undefined);
    await api.summary().catch(() => undefined);
    await api.summary({ from: '2026-09-01', to: '2026-09-30' }).catch(() => undefined);
    expect(await api.availableFirms()).toEqual([]);
    await api.subscription(id(1)).catch(() => undefined);
    expect(calls.map(path)).toEqual([
      'GET /meta',
      'GET /summary',
      'GET /summary?from=2026-09-01&to=2026-09-30',
      'GET /available-firms',
      `GET /${id(1)}`,
    ]);
    await expect(api.summary({ to: '2026-09-30' })).rejects.toBeInstanceOf(ApiRequestError);
    await expect(api.subscription('not-a-uuid')).rejects.toBeInstanceOf(ApiRequestError);
    expect(calls).toHaveLength(5);
  });

  it('creates a subscription with the defaults filled in', async () => {
    const { fn, calls } = fakeFetch(201, result());
    const created = await client(fn).create({
      firmId: id(2),
      mode: 'TRIAL',
      planId: id(3),
      billingCycle: 'MONTHLY',
      seats: 3,
    });
    expect(created.subscription.id).toBe(id(1));
    expect(calls[0]).toMatchObject({ method: 'POST', url: '/api/v1/admin/subscriptions' });
    expect(calls[0]!.body).toEqual({
      firmId: id(2),
      mode: 'TRIAL',
      planId: id(3),
      billingCycle: 'MONTHLY',
      seats: 3,
      extraLocations: 0,
    });
    const api = client(fn);
    const base = {
      firmId: id(2),
      mode: 'PAID',
      planId: id(3),
      billingCycle: 'ANNUAL',
      seats: 3,
    } as const;
    await expect(api.create({ ...base, seats: 0 })).rejects.toBeInstanceOf(ApiRequestError);
    await expect(api.create({ ...base, seats: 2.5 })).rejects.toBeInstanceOf(ApiRequestError);
    await expect(api.create({ ...base, extraLocations: 101 })).rejects.toBeInstanceOf(
      ApiRequestError,
    );
    await expect(api.create({ ...base, mode: 'FREE' as 'PAID' })).rejects.toBeInstanceOf(
      ApiRequestError,
    );
    await expect(
      api.create({ ...base, billingCycle: 'QUARTERLY' as 'ANNUAL' }),
    ).rejects.toBeInstanceOf(ApiRequestError);
    await expect(
      api.create({ ...base, accountOwner: 'Jordan Sales' } as typeof base),
    ).rejects.toBeInstanceOf(ApiRequestError);
    expect(calls).toHaveLength(1);
  });

  it('posts every change to its own path with the parsed body', async () => {
    const { fn, calls } = fakeFetch(200, result());
    const api = client(fn);
    await api.changePlan(id(1), { planId: id(4), billingCycle: 'ANNUAL' });
    await api.updateSeats(id(1), { seats: 8 });
    await api.updateLocations(id(1), { extraLocations: 1 });
    await api.extendTrial(id(1), { days: 14, reason: ' Owner asked for more time ' });
    await api.convertToPaid(id(1), { planId: id(3), billingCycle: 'MONTHLY' });
    await api.turnOffAutoRenew(id(1), {
      confirmed: true,
      source: 'EMAIL',
      notes: 'The owner asked not to renew after this term.',
    });
    await api.reverseCancellation(id(1), { autoRenewOn: true, reason: 'Changed their mind.' });
    await api.suspend(id(1), { kind: 'PAUSE', reason: 'Seasonal pause until January.' });
    await api.reactivate(id(1), { reason: 'Pause ended.' });
    await api.close(id(1), {
      reason: 'The firm merged into another practice.',
      confirmName: 'sample blue ridge tax',
      impactReviewed: true,
    });
    await api.setPrice(id(1), {
      baseCents: 15_000,
      reason: 'Two-year commitment.',
      approvedBy: 'Morgan Admin',
    });
    await api.changeBillingDate(id(1), { date: '2026-11-10', reason: 'Align with payroll.' });
    expect(calls.map(path)).toEqual([
      `POST /${id(1)}/plan`,
      `POST /${id(1)}/seats`,
      `POST /${id(1)}/locations`,
      `POST /${id(1)}/extend-trial`,
      `POST /${id(1)}/convert`,
      `POST /${id(1)}/auto-renew/off`,
      `POST /${id(1)}/auto-renew/on`,
      `POST /${id(1)}/suspend`,
      `POST /${id(1)}/reactivate`,
      `POST /${id(1)}/close`,
      `POST /${id(1)}/price`,
      `POST /${id(1)}/billing-date`,
    ]);
    expect(calls.map((call) => call.body)).toEqual([
      { planId: id(4), billingCycle: 'ANNUAL' },
      { seats: 8 },
      { extraLocations: 1 },
      { days: 14, reason: 'Owner asked for more time' },
      { planId: id(3), billingCycle: 'MONTHLY' },
      { confirmed: true, source: 'EMAIL', notes: 'The owner asked not to renew after this term.' },
      { autoRenewOn: true, reason: 'Changed their mind.' },
      { kind: 'PAUSE', reason: 'Seasonal pause until January.' },
      { reason: 'Pause ended.', paymentConfirmed: false },
      {
        reason: 'The firm merged into another practice.',
        confirmName: 'sample blue ridge tax',
        impactReviewed: true,
      },
      { baseCents: 15_000, reason: 'Two-year commitment.', approvedBy: 'Morgan Admin' },
      { date: '2026-11-10', reason: 'Align with payroll.' },
    ]);
    await expect(api.updateSeats('not-a-uuid', { seats: 3 })).rejects.toBeInstanceOf(
      ApiRequestError,
    );
    expect(calls).toHaveLength(12);
  });

  it('refuses a renewal change without the client-request confirmation and a note', async () => {
    const { fn, calls } = fakeFetch(200, result());
    const api = client(fn);
    const base = { confirmed: true, source: 'PHONE', notes: 'Called on Oct 19.' } as const;
    await expect(
      api.turnOffAutoRenew(id(1), { ...base, confirmed: false as true }),
    ).rejects.toMatchObject({ message: 'Confirm that the client asked for this.' });
    await expect(api.turnOffAutoRenew(id(1), { ...base, notes: '   ' })).rejects.toMatchObject({
      message: 'Add a note about the request.',
    });
    await expect(
      api.turnOffAutoRenew(id(1), { ...base, source: 'FAX' as 'PHONE' }),
    ).rejects.toBeInstanceOf(ApiRequestError);
    await expect(
      api.turnOffAutoRenew(id(1), { ...base, notes: 'x'.repeat(1001) }),
    ).rejects.toBeInstanceOf(ApiRequestError);
    await expect(
      api.reverseCancellation(id(1), { autoRenewOn: false as true, reason: 'Stays.' }),
    ).rejects.toMatchObject({
      message: 'Choose to turn Auto-Renew back on to reverse the cancellation.',
    });
    expect(calls).toHaveLength(0);
  });

  it('checks the lifecycle, price and note bodies before sending', async () => {
    const { fn, calls } = fakeFetch(200, result());
    const api = client(fn);
    // A restart names both a plan and a cycle, or neither.
    await expect(api.reactivate(id(1), { reason: 'Back.', planId: id(3) })).rejects.toMatchObject({
      message: 'Choose a plan and a billing cycle.',
    });
    await api.reactivate(id(1), {
      reason: 'Back.',
      paymentConfirmed: true,
      planId: id(3),
      billingCycle: 'ANNUAL',
    });
    expect(calls[0]!.body).toEqual({
      reason: 'Back.',
      paymentConfirmed: true,
      planId: id(3),
      billingCycle: 'ANNUAL',
    });
    await expect(api.extendTrial(id(1), { days: 61, reason: 'Long.' })).rejects.toMatchObject({
      message: 'Add between 1 and 60 days.',
    });
    await expect(api.extendTrial(id(1), { days: 0, reason: 'None.' })).rejects.toBeInstanceOf(
      ApiRequestError,
    );
    await expect(
      api.suspend(id(1), { kind: 'HOLIDAY' as 'PAUSE', reason: 'x' }),
    ).rejects.toBeInstanceOf(ApiRequestError);
    // The platform tables refuse a soft hyphen and a line separator that `text` allows.
    await expect(
      api.suspend(id(1), { kind: 'ADMIN', reason: 'Policy­breach' }),
    ).rejects.toBeInstanceOf(ApiRequestError);
    await expect(
      api.close(id(1), { reason: 'Done.', confirmName: 'Sample', impactReviewed: false as true }),
    ).rejects.toMatchObject({ message: 'Confirm you reviewed the data and access impact.' });
    await expect(api.setPrice(id(1), { baseCents: 15_000, reason: 'Deal.' })).rejects.toMatchObject(
      { message: 'Enter who approved it.' },
    );
    await expect(
      api.setPrice(id(1), { baseCents: -1, reason: 'Deal.', approvedBy: 'Morgan Admin' }),
    ).rejects.toBeInstanceOf(ApiRequestError);
    await api.setPrice(id(1), { baseCents: null, reason: 'Back to the plan price.' });
    expect(calls[1]!.body).toEqual({ baseCents: null, reason: 'Back to the plan price.' });
    await expect(
      api.changeBillingDate(id(1), { date: '2026-11-10T00:00:00Z', reason: 'x' }),
    ).rejects.toBeInstanceOf(ApiRequestError);
    await expect(api.addNote(id(1), { body: '  ' })).rejects.toBeInstanceOf(ApiRequestError);
    await expect(api.addNote(id(1), { body: 'x'.repeat(4001) })).rejects.toBeInstanceOf(
      ApiRequestError,
    );
    expect(calls).toHaveLength(2);
  });

  it('adds a note and reads it back', async () => {
    const note = { id: id(50), body: 'Left a voicemail.', author: 'Morgan Admin', createdAt: at };
    const { fn, calls } = fakeFetch(201, note);
    expect(await client(fn).addNote(id(1), { body: ' Left a voicemail. ' })).toEqual(note);
    expect(calls[0]).toMatchObject({
      method: 'POST',
      url: `/api/v1/admin/subscriptions/${id(1)}/notes`,
      body: { body: 'Left a voicemail.' },
    });
  });

  it('builds the export link from ids or the filters', () => {
    expect(adminSubscriptionsExportPath()).toBe('/admin/subscriptions/export');
    expect(adminSubscriptionsExportPath({ ids: [id(1), id(7)] })).toBe(
      `/admin/subscriptions/export?ids=${id(1)}%2C${id(7)}`,
    );
    expect(adminSubscriptionsExportPath({ status: 'PAST_DUE', search: ' maple ' })).toBe(
      '/admin/subscriptions/export?search=maple&status=PAST_DUE',
    );
    expect(() =>
      adminSubscriptionsExportPath({ ids: Array.from({ length: 101 }, (_, n) => id(n)) }),
    ).toThrow(ApiRequestError);
    expect(() => adminSubscriptionsExportPath({ from: '2026-10-01' })).toThrow(ApiRequestError);
    expect(() => adminSubscriptionsExportPath({ ids: ['not-a-uuid'] })).toThrow(ApiRequestError);
  });

  it('reads a record in the documented shape and drops unknown fields', async () => {
    const { fn } = fakeFetch(200, { ...record(), somethingNew: 'dropped' });
    const read = await client(fn).subscription(id(1));
    expect(read).not.toHaveProperty('somethingNew');
    expect(read.nextBillingOn).toBe('2026-11-05');
    // The mock's CLOSED is the database's CANCELLED with a closure.
    expect(SubscriptionRecord.safeParse({ ...record(), status: 'CLOSED' }).success).toBe(false);
    expect(
      SubscriptionRecord.safeParse({
        ...record(),
        status: 'CANCELLED',
        closure: { closedAt: at, reason: 'The firm merged into another practice.' },
      }).success,
    ).toBe(true);
    const bad = fakeFetch(200, { ...record(), seatsUsed: '4' });
    await expect(client(bad.fn).subscription(id(1))).rejects.toThrow();
  });

  it('prices plans per billing cycle, with extras and a negotiated base', () => {
    expect(subscriptionPriceCents(TEAM_PRO, { billingCycle: 'MONTHLY', extraSeats: 2 })).toBe(
      25_700,
    );
    expect(subscriptionPriceCents(TEAM_PRO, { billingCycle: 'ANNUAL', extraSeats: 2 })).toBe(
      308_400,
    );
    expect(
      subscriptionPriceCents(TEAM_PRO, {
        billingCycle: 'MONTHLY',
        extraSeats: 2,
        baseCents: 15_000,
      }),
    ).toBe(20_800);
    // Seats a plan does not sell add nothing; locations at its rate.
    expect(
      subscriptionPriceCents(ENTERPRISE, {
        billingCycle: 'MONTHLY',
        extraSeats: 5,
        extraLocations: 1,
      }),
    ).toBe(94_800);
    expect(
      subscriptionPriceCents(
        { ...TEAM_PRO, billingCycle: 'ANNUAL', priceCents: 238_801 },
        { billingCycle: 'MONTHLY' },
      ),
    ).toBe(19_900);
    expect(subscriptionMonthlyCents(308_401, 'ANNUAL')).toBe(25_700);
    expect(subscriptionMonthlyCents(20_800, 'MONTHLY')).toBe(20_800);
    expect(subscriptionSeatRange(TEAM_PRO)).toEqual({ min: 3, max: 10 });
    expect(subscriptionSeatRange(SOLO_PRO)).toEqual({ min: 1, max: 1 });
    expect(subscriptionSeatRange(ENTERPRISE)).toEqual({ min: 20, max: 20 });
    expect(subscriptionSeatRange({ ...TEAM_PRO, maxSeats: null })).toEqual({ min: 3, max: null });
  });

  it('works out the days and the proration the API bills', () => {
    expect(subscriptionAddDays('2026-10-20', 14)).toBe('2026-11-03');
    expect(subscriptionDaysBetween('2026-10-20', '2026-11-03')).toBe(14);
    expect(subscriptionAddMonths('2026-01-31', 1)).toBe('2026-02-28');
    expect(subscriptionAddMonths('2028-01-31', 1)).toBe('2028-02-29');
    expect(subscriptionAddMonths('2026-11-15', 2)).toBe('2027-01-15');
    expect(subscriptionAddMonths('2026-10-20', 12)).toBe('2027-10-20');

    const base = {
      today: '2026-10-20',
      status: 'ACTIVE' as const,
      periodStart: '2026-10-05',
      periodEnd: '2026-11-05',
      from: { priceCents: 19_900, billingCycle: 'MONTHLY' as const },
    };
    // 16 of 31 days left.
    expect(
      subscriptionProration({ ...base, to: { priceCents: 25_700, billingCycle: 'MONTHLY' } }),
    ).toEqual({ amountCents: 2_994, nextBillingOn: '2026-11-05' });
    expect(
      subscriptionProration({ ...base, to: { priceCents: 238_800, billingCycle: 'ANNUAL' } }),
    ).toEqual({ amountCents: 228_529, nextBillingOn: '2027-10-20' });
    expect(
      subscriptionProration({
        ...base,
        status: 'TRIAL',
        to: { priceCents: 49_900, billingCycle: 'MONTHLY' },
      }),
    ).toEqual({ amountCents: 0, nextBillingOn: '2026-11-05' });
    expect(
      subscriptionProration({
        ...base,
        periodEnd: null,
        to: { priceCents: 49_900, billingCycle: 'MONTHLY' },
      }),
    ).toEqual({ amountCents: 0, nextBillingOn: null });

    expect(subscriptionBillingDateCents(record(), '2026-11-10')).toBe(3_355);
    expect(subscriptionBillingDateCents(record(), '2026-11-01')).toBe(-2_684);
    expect(subscriptionBillingDateCents({ ...record(), nextBillingOn: null }, '2026-11-10')).toBe(
      0,
    );
  });

  it('previews a plan, seat or location change with the numbers the API uses', () => {
    const sub = record();
    const up = previewSubscriptionChange(sub, BUSINESS, {}, sub.today);
    expect(up).toEqual({
      planId: id(4),
      billingCycle: 'MONTHLY',
      seats: 10,
      extraSeats: 0,
      extraLocations: 0,
      droppedLocations: 0,
      baseOverrideCents: null,
      priceCents: 49_900,
      monthlyCents: 49_900,
      amountCents: 15_019,
      nextBillingOn: '2026-11-05',
      blocked: null,
    });
    // Same plan: the negotiated base stays.
    const seats = previewSubscriptionChange(sub, TEAM_PRO, { seats: 8 }, sub.today);
    expect(seats).toMatchObject({ priceCents: 29_500, amountCents: 4_490, blocked: null });
    expect(seats.baseOverrideCents).toBe(15_000);
    expect(previewSubscriptionChange(sub, TEAM_PRO, { seats: 3 }, sub.today).blocked).toBe(
      'SEATS_IN_USE',
    );
    expect(previewSubscriptionChange(sub, TEAM_PRO, { seats: 11 }, sub.today).blocked).toBe(
      'SEATS_OUT_OF_RANGE',
    );
    expect(previewSubscriptionChange(sub, TEAM_PRO, { extraLocations: 1 }, sub.today).blocked).toBe(
      'LOCATIONS_NOT_OFFERED',
    );
    // A larger firm cannot move to a plan that holds fewer seats than it uses.
    const busy = { ...sub, plan: { id: id(4) }, seatsAllowed: 14, seatsUsed: 12 };
    expect(previewSubscriptionChange(busy, TEAM_PRO, {}, sub.today)).toMatchObject({
      seats: 10,
      blocked: 'SEATS_IN_USE',
    });
    // Extra locations the new plan does not sell are dropped.
    const multi = { ...sub, plan: { id: id(5) }, seatsAllowed: 20, extraLocations: 2 };
    expect(previewSubscriptionChange(multi, BUSINESS, {}, sub.today)).toMatchObject({
      seats: 20,
      extraLocations: 0,
      droppedLocations: 2,
    });
    // During a trial nothing is billed.
    expect(
      previewSubscriptionChange({ ...sub, status: 'TRIAL' }, BUSINESS, {}, sub.today).amountCents,
    ).toBe(0);
  });

  it('words the events and sorts them into the tabs', () => {
    expect(subscriptionEventText(event({ action: 'CREATED', toStatus: 'TRIAL' }))).toBe(
      'Trial started',
    );
    expect(subscriptionEventText(event({ action: 'CREATED', toStatus: 'ACTIVE' }))).toBe(
      'Subscription started',
    );
    const status = (
      fromStatus: SubscriptionEvent['fromStatus'],
      toStatus: SubscriptionEvent['toStatus'],
    ) => subscriptionEventText(event({ fromStatus, toStatus }));
    expect(status('TRIAL', 'ACTIVE')).toBe('Converted to paid');
    expect(status('TRIAL', 'EXPIRED')).toBe('Trial expired');
    expect(status('ACTIVE', 'PAST_DUE')).toBe('Payment failed');
    expect(status('PAST_DUE', 'ACTIVE')).toBe('Payment received');
    expect(status('PAST_DUE', 'SUSPENDED')).toBe('Suspended');
    expect(status('SUSPENDED', 'ACTIVE')).toBe('Reactivated');
    expect(status('SUSPENDED', 'CANCELLED')).toBe('Subscription ended');
    expect(status('EXPIRED', 'ACTIVE')).toBe('Reactivated');
    expect(status('NON_RENEWING', 'ACTIVE')).toBe('Cancellation reversed');
    expect(
      subscriptionEventText(event({ source: 'AUDIT', action: 'PRICE_CHANGED', fromCents: 15_000 })),
    ).toBe('Negotiated price removed');
    expect(subscriptionEventText(event({ action: 'CANCEL_REQUESTED' }))).toBe(
      'Auto-Renew turned off',
    );
    expect(SUBSCRIPTION_EVENT_CATEGORY.RENEWED).toBe('BILLING');
    expect(SUBSCRIPTION_EVENT_CATEGORY.NOTE_ADDED).toBe('NOTE');
    expect(SUBSCRIPTION_EVENT_CATEGORY.EXPORTED).toBe('ACCESS');
  });

  it('has a message for every error code', () => {
    for (const code of SubscriptionErrorCode.options)
      expect(SUBSCRIPTION_ERRORS[code]).toBeTruthy();
  });
});
