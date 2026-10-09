// R7: the invoice's open checkouts as Stripe sees them, and the cap on transactions that wait on
// Stripe while they hold a pooled connection.
import { describe, expect, it, vi } from 'vitest';
import type { TxClient } from '@firmivra/db';
import type { AuditService } from '../../src/audit/audit.service.js';
import {
  oneAtATime,
  openCheckouts,
  SESSION_MS,
  withStripeHold,
} from '../../src/payments/checkout/checkout-sessions.js';
import { FakeStripeGateway } from '../../src/payments/stripe/fake-stripe.js';

const BUSINESS = '00000000-0000-4000-8000-000000000001';
const INVOICE = '00000000-0000-4000-8000-000000000002';

function world(createdAt: Date) {
  const pending = {
    id: '00000000-0000-4000-8000-000000000003',
    processorRef: 'cs_fakegone',
    accountId: 'acct_fakeold',
    amountCents: 5_000,
    createdAt,
  };
  const updateMany = vi.fn(async () => ({ count: 1 }));
  const tx = { payment: { findMany: vi.fn(async () => [pending]), updateMany } };
  const logIn = vi.fn(async () => undefined);
  return {
    tx: tx as unknown as TxClient,
    audit: { logIn } as unknown as AuditService,
    updateMany,
    logIn,
    pending,
  };
}

describe('openCheckouts', () => {
  it('expires a checkout older than its session that Stripe no longer knows, without blocking', async () => {
    const w = world(new Date(Date.now() - SESSION_MS - 20 * 60_000));
    const open = await openCheckouts(w.tx, new FakeStripeGateway(), w.audit, BUSINESS, INVOICE);
    expect(open).toEqual([]);
    expect(w.updateMany).toHaveBeenCalledWith({
      where: { businessId: BUSINESS, id: w.pending.id, status: 'PENDING' },
      data: { status: 'FAILED', failureCode: 'checkout_expired' },
    });
    expect(w.logIn).toHaveBeenCalledWith(
      w.tx,
      'payment.failed',
      { type: 'payment', id: w.pending.id },
      { invoiceId: INVOICE, failureCode: 'checkout_expired' },
    );
  });

  it('answers 503 and marks nothing when Stripe times out on an old checkout (it may have been paid)', async () => {
    const w = world(new Date(Date.now() - SESSION_MS - 20 * 60_000));
    const stripe = new FakeStripeGateway();
    stripe.down = true;
    await expect(openCheckouts(w.tx, stripe, w.audit, BUSINESS, INVOICE)).rejects.toMatchObject({
      status: 503,
    });
    expect(w.updateMany).not.toHaveBeenCalled();
  });

  it('answers 503 for a young checkout Stripe does not answer for (it may still be paid)', async () => {
    const w = world(new Date(Date.now() - 60_000));
    await expect(
      openCheckouts(w.tx, new FakeStripeGateway(), w.audit, BUSINESS, INVOICE),
    ).rejects.toMatchObject({ status: 503 });
    expect(w.updateMany).not.toHaveBeenCalled();
  });

  it('still answers PAYMENT_IN_PROGRESS for an old checkout Stripe says was paid', async () => {
    const w = world(new Date(Date.now() - 3 * SESSION_MS));
    const stripe = new FakeStripeGateway();
    const session = await stripe.createCheckoutSession(
      {
        accountId: w.pending.accountId,
        invoiceId: INVOICE,
        paymentId: w.pending.id,
        description: 'Invoice 1',
        amountCents: 5_000,
        currency: 'usd',
        successUrl: 'https://portal.example.test/x',
        cancelUrl: 'https://portal.example.test/x',
        expiresAt: new Date(),
      },
      'key',
    );
    stripe.setSession(session.id, { status: 'complete' });
    w.pending.processorRef = session.id;
    await expect(openCheckouts(w.tx, stripe, w.audit, BUSINESS, INVOICE)).rejects.toMatchObject({
      status: 409,
    });
    expect(w.updateMany).not.toHaveBeenCalled();
  });
});

describe('withStripeHold', () => {
  it('lets three wait on Stripe at once and answers the fourth 503 SERVICE_BUSY with Retry-After', async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const held = [1, 2, 3].map(() => withStripeHold(() => gate));
    const fourth = await withStripeHold(async () => 'ran').catch((e: unknown) => e);
    expect(fourth).toMatchObject({
      status: 503,
      response: { code: 'SERVICE_BUSY', retryAfter: 5 },
    });
    release();
    await Promise.all(held);
    await expect(withStripeHold(async () => 'ran')).resolves.toBe('ran');
  });

  it('frees its place when the work fails', async () => {
    for (let i = 0; i < 5; i += 1) {
      await expect(
        withStripeHold(async () => {
          throw new Error('Stripe down');
        }),
      ).rejects.toThrow('Stripe down');
    }
    await expect(withStripeHold(async () => 'ran')).resolves.toBe('ran');
  });
});

describe('oneAtATime', () => {
  const A = '00000000-0000-4000-8000-0000000000aa';
  const B = '00000000-0000-4000-8000-0000000000bb';

  it('runs a second one for the same invoice after the first, waiting without a connection', async () => {
    const order: string[] = [];
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const first = oneAtATime(BUSINESS, A, async () => {
      await gate;
      order.push('first');
    });
    const second = oneAtATime(BUSINESS, A, async () => {
      order.push('second');
    });
    setTimeout(release, 50);
    await Promise.all([first, second]);
    expect(order).toEqual(['first', 'second']);
  });

  it('answers 409 PAYMENT_IN_PROGRESS after a second, and never blocks other invoices or firms', async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const held = oneAtATime(BUSINESS, A, () => gate);
    await expect(oneAtATime(BUSINESS, B, async () => 'other invoice')).resolves.toBe(
      'other invoice',
    );
    await expect(oneAtATime(INVOICE, A, async () => 'other firm')).resolves.toBe('other firm');
    await expect(oneAtATime(BUSINESS, A, async () => 'ran')).rejects.toMatchObject({
      status: 409,
      response: { code: 'PAYMENT_IN_PROGRESS' },
    });
    release();
    await held;
    await expect(oneAtATime(BUSINESS, A, async () => 'ran')).resolves.toBe('ran');
  });

  it('frees the invoice when the work fails', async () => {
    await expect(
      oneAtATime(BUSINESS, A, async () => {
        throw new Error('failed');
      }),
    ).rejects.toThrow('failed');
    await expect(oneAtATime(BUSINESS, A, async () => 'ran')).resolves.toBe('ran');
  });
});
