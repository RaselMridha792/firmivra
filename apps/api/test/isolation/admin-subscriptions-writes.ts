// R60: the Super Admin Subscriptions writes for admin-scope.test.ts, each against a subscription
// of its own in the state its change needs (a trial to extend and convert, Active with Auto-Renew
// on, Non-Renewing, Suspended with nothing due, Active with a next billing day), each on a firm of
// its own (a firm has one subscription) with a billing profile, so every change that moves money
// can bill. Firms in platform scope; plans and subscriptions in the Super Admin's admin scope.
import { randomUUID } from 'node:crypto';
import { createPrismaClient, runInScope, type TxClient } from '@firmivra/db';
import { TEST_CLIENT_OPTIONS, testDatabaseUrls } from '@firmivra/db/testing';
import type { Fixtures } from '../global-setup.js';
import { records, type SupportWrite } from './admin-support-writes.js';

const day = (offset = 0) => {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + offset);
  return d.toISOString().slice(0, 10);
};
const date = (offset = 0) => new Date(`${day(offset)}T00:00:00.000Z`);
/** A month from today, as the subscriptions' period end. */
const nextMonth = () => {
  const d = new Date(`${day()}T00:00:00.000Z`);
  const target = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1));
  const last = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0));
  target.setUTCDate(Math.min(d.getUTCDate(), last.getUTCDate()));
  return target;
};

const refs = { planA: '', planB: '', closeName: '' };

type State = 'ACTIVE' | 'TRIAL' | 'NON_RENEWING' | 'SUSPENDED';
/** Each write's subscription (a key of `records`) and the state it starts in. */
const CASES: readonly [string, State][] = [
  ['subsPlan', 'ACTIVE'],
  ['subsSeats', 'ACTIVE'],
  ['subsLocations', 'ACTIVE'],
  ['subsExtend', 'TRIAL'],
  ['subsConvert', 'TRIAL'],
  ['subsRenewOff', 'ACTIVE'],
  ['subsRenewOn', 'NON_RENEWING'],
  ['subsSuspend', 'ACTIVE'],
  ['subsReactivate', 'SUSPENDED'],
  ['subsPrice', 'ACTIVE'],
  ['subsDate', 'ACTIVE'],
  ['subsClose', 'ACTIVE'],
  ['subsNotes', 'TRIAL'],
];

function stateData(state: State) {
  const now = new Date();
  if (state === 'TRIAL') return { status: state, trialStartedAt: now, trialEndsAt: date(14) };
  const end = nextMonth();
  return {
    status: state,
    startedAt: now,
    currentPeriodStart: date(),
    currentPeriodEnd: end,
    nextBillingDate: end,
    paidThroughDate: end,
    ...(state === 'NON_RENEWING'
      ? {
          autoRenew: false,
          cancelRequestedAt: now,
          cancelReason: 'Fake scope request',
          cancelRequestSource: 'EMAIL',
        }
      : {}),
    ...(state === 'SUSPENDED' ? { suspendedAt: now, suspendedReason: 'Fake scope hold' } : {}),
  };
}

/** The subscriptions (and the free firm) the Subscriptions writes act on. */
export async function prepareSubscriptions(fx: Fixtures): Promise<void> {
  const owner = createPrismaClient(testDatabaseUrls('test_api').owner, TEST_CLIENT_OPTIONS);
  const tag = randomUUID().slice(0, 8);
  const firmOf: Record<string, string> = {};
  try {
    await runInScope(owner, { kind: 'platform' }, async (tx) => {
      for (const key of [...CASES.map(([k]) => k), 'subsFree']) {
        const name = `Fake Scope ${key} ${tag}`;
        const firm = await tx.business.create({
          data: { slug: `scope-${tag}-${key.toLowerCase()}`, name, status: 'ACTIVE' },
          select: { id: true },
        });
        await tx.platformFirmBillingProfile.create({
          data: {
            businessId: firm.id,
            billingContactName: 'Fake Scope Contact',
            billingContactEmail: `scope-${tag}@example.test`,
            taxRateBps: 0,
          },
        });
        firmOf[key] = firm.id;
        if (key === 'subsClose') refs.closeName = name;
      }
    });
    await runInScope(owner, { kind: 'admin', adminUserId: fx.users.admin.id }, async (tx) => {
      const plan = (code: string, displayOrder: number, basePriceCents: number) =>
        tx.platformPlan.create({
          data: {
            code: `SCOPE_${code}_${tag.toUpperCase()}`,
            name: `Fake Scope Plan ${code}`,
            basePriceCents,
            includedSeats: 2,
            maxSeats: 10,
            overagePriceCentsPerSeat: 1_000,
            overagePriceCentsPerLocation: 2_000,
            displayOrder,
          },
          select: { id: true },
        });
      refs.planA = (await plan('A', 950, 10_000)).id;
      refs.planB = (await plan('B', 951, 20_000)).id;
      for (const [key, state] of CASES) records[key] = await subscription(tx, firmOf[key]!, state);
      records.subsFree = firmOf.subsFree!;
    });
  } finally {
    await owner.$disconnect();
  }
}

async function subscription(tx: TxClient, businessId: string, state: State): Promise<string> {
  const row = await tx.platformFirmSubscription.create({
    data: {
      businessId,
      planId: refs.planA,
      seatsIncluded: 2,
      seatsPurchased: 1,
      ...stateData(state),
    },
    select: { id: true },
  });
  return row.id;
}

const S = '/api/v1/admin/subscriptions';

/** Each Subscriptions write with a body that passes validation, in the order the sweep runs them. */
export function subscriptionsWrites(): Record<string, SupportWrite> {
  return {
    [`POST ${S}`]: {
      body: () =>
        Promise.resolve({
          firmId: records.subsFree,
          mode: 'TRIAL',
          planId: refs.planA,
          billingCycle: 'MONTHLY',
          seats: 2,
        }),
    },
    [`POST ${S}/:id/plan`]: {
      record: 'subsPlan',
      body: () => Promise.resolve({ planId: refs.planB, billingCycle: 'MONTHLY' }),
    },
    [`POST ${S}/:id/seats`]: { record: 'subsSeats', body: { seats: 4 } },
    [`POST ${S}/:id/locations`]: { record: 'subsLocations', body: { extraLocations: 1 } },
    [`POST ${S}/:id/extend-trial`]: {
      record: 'subsExtend',
      body: { days: 7, reason: 'Fake scope reason' },
    },
    [`POST ${S}/:id/convert`]: {
      record: 'subsConvert',
      body: () => Promise.resolve({ planId: refs.planA, billingCycle: 'MONTHLY' }),
    },
    [`POST ${S}/:id/auto-renew/off`]: {
      record: 'subsRenewOff',
      body: { confirmed: true, source: 'EMAIL', notes: 'Fake scope request' },
    },
    [`POST ${S}/:id/auto-renew/on`]: {
      record: 'subsRenewOn',
      body: { autoRenewOn: true, reason: 'Fake scope reason' },
    },
    [`POST ${S}/:id/suspend`]: {
      record: 'subsSuspend',
      body: { kind: 'ADMIN', reason: 'Fake scope reason' },
    },
    [`POST ${S}/:id/reactivate`]: {
      record: 'subsReactivate',
      body: { reason: 'Fake scope reason' },
    },
    [`POST ${S}/:id/price`]: {
      record: 'subsPrice',
      body: { baseCents: 5_000, reason: 'Fake scope reason', approvedBy: 'Fake Approver' },
    },
    [`POST ${S}/:id/billing-date`]: {
      record: 'subsDate',
      body: () => Promise.resolve({ date: day(10), reason: 'Fake scope reason' }),
    },
    [`POST ${S}/:id/close`]: {
      record: 'subsClose',
      body: () =>
        Promise.resolve({
          reason: 'Fake scope reason',
          confirmName: refs.closeName,
          impactReviewed: true,
        }),
    },
    [`POST ${S}/:id/notes`]: { record: 'subsNotes', body: { body: 'Fake scope note' } },
  };
}
