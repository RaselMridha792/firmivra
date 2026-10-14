// R36 (Invoices and Payments, r36_autopay_methods): the payment method a client saved for AutoPay.
// Runs as the app role under RLS.
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { createDatabase, createPrismaClient, runInScope } from '../src/client.js';
import { TEST_CLIENT_OPTIONS } from '../src/testing.js';
import { createFirms, expectInvisibleToOtherFirm } from './r36-helpers.js';

const urls = inject('dbUrls');
const owner = createPrismaClient(urls.owner, TEST_CLIENT_OPTIONS);
const app = createPrismaClient(urls.app, TEST_CLIENT_OPTIONS);
const db = createDatabase(urls.app, TEST_CLIENT_OPTIONS);

let f: Awaited<ReturnType<typeof createFirms>>;
const stripeId = () => randomUUID().replace(/-/g, '');
const accounts = { A: `acct_${stripeId()}`, B: `acct_${stripeId()}` };
const A = () => ({ businessId: f.firmA });
const firmA = () => db.forBusiness(f.firmA);
const firmB = () => db.forBusiness(f.firmB);
const method = (data: Record<string, unknown> = {}) =>
  firmA().clientPaymentMethod.create({
    data: {
      ...A(),
      clientId: f.client,
      customerRef: `cus_${stripeId()}`,
      methodRef: `pm_${stripeId()}`,
      accountId: accounts.A,
      methodType: 'card',
      cardBrand: 'visa',
      last4: '4242',
      expMonth: 12,
      expYear: 2030,
      authorizedAt: new Date(),
      ...data,
    },
  });

beforeAll(async () => {
  f = await createFirms(owner, 'am');
  await runInScope(owner, { kind: 'platform' }, async (tx) => {
    await tx.stripeAccount.create({
      data: { ...A(), accountId: accounts.A, chargesEnabled: true },
    });
    await tx.stripeAccount.create({
      data: { businessId: f.firmB, accountId: accounts.B, chargesEnabled: true },
    });
  });
});

afterAll(async () => {
  await Promise.all([owner.$disconnect(), app.$disconnect(), db.disconnect()]);
});

describe('client payment methods', () => {
  it("keep Stripe's references and what the screens show, on the firm's own account", async () => {
    const saved = await method({ isDefault: true });
    expect(saved).toMatchObject({ status: 'ACTIVE', last4: '4242', cardBrand: 'visa' });
    await expect(method({ accountId: accounts.B })).rejects.toThrow(/own Stripe account/);
    await expect(method({ accountId: `acct_${stripeId()}` })).rejects.toThrow(/own Stripe account/);
    await expect(method({ customerRef: 'cus_1 2' })).rejects.toThrow(/check constraint/i);
    await expect(method({ methodRef: `card_${stripeId()}` })).rejects.toThrow(/check constraint/i);
    await expect(method({ last4: '42424' })).rejects.toThrow(/check constraint/i);
    await expect(method({ methodType: 'us_bank_account' })).rejects.toThrow(/check constraint/i); // brand needs card
    await expect(
      method({
        methodType: 'us_bank_account',
        cardBrand: null,
        last4: '6789',
        expMonth: null,
        expYear: null,
      }),
    ).resolves.toBeTruthy();
    await expect(method({ expMonth: 13 })).rejects.toThrow(/check constraint/i);
    await expect(method({ expYear: null })).rejects.toThrow(/check constraint/i);
  });

  it('one Stripe method is saved once, and a client has one live default', async () => {
    const ref = `pm_${stripeId()}`;
    await method({ methodRef: ref });
    await expect(method({ methodRef: ref })).rejects.toThrow(/unique/i);
    const solo = await runInScope(owner, { kind: 'platform' }, async (tx) => {
      const b = await tx.business.create({ data: { slug: `ri-c-${f.run}`, name: 'C' } });
      await tx.stripeAccount.create({
        data: { businessId: b.id, accountId: `acct_${stripeId()}`, chargesEnabled: true },
      });
      return b;
    });
    const acct = await runInScope(owner, { kind: 'platform' }, (tx) =>
      tx.stripeAccount.findUniqueOrThrow({ where: { businessId: solo.id } }),
    );
    const client = await runInScope(owner, { kind: 'business', businessId: solo.id }, (tx) =>
      tx.client.create({ data: { businessId: solo.id, displayName: 'C client' } }),
    );
    const c = db.forBusiness(solo.id);
    const make = (isDefault: boolean) =>
      c.clientPaymentMethod.create({
        data: {
          businessId: solo.id,
          clientId: client.id,
          customerRef: `cus_${stripeId()}`,
          methodRef: `pm_${stripeId()}`,
          accountId: acct.accountId,
          methodType: 'card',
          cardBrand: 'visa',
          last4: '1111',
          authorizedAt: new Date(),
          isDefault,
        },
      });
    const first = await make(true);
    await expect(make(true)).rejects.toThrow(/unique/i);
    await c.clientPaymentMethod.update({ where: { id: first.id }, data: { isDefault: false } });
    await expect(make(true)).resolves.toBeTruthy();
  });

  it('change only the default, the expiry and the removal; a removed one stays removed', async () => {
    const saved = await method();
    const set = (data: Record<string, unknown>) =>
      firmA().clientPaymentMethod.update({ where: { id: saved.id }, data });
    await expect(set({ last4: '9999' })).rejects.toThrow(/only the default/);
    await expect(set({ methodRef: `pm_${stripeId()}` })).rejects.toThrow(/only the default/);
    await expect(set({ authorizedAt: new Date() })).rejects.toThrow(/only the default/);
    await expect(set({ expMonth: 1, expYear: 2031 })).resolves.toBeTruthy();
    await expect(set({ status: 'REMOVED' })).rejects.toThrow(/check constraint/i);
    await expect(set({ status: 'REMOVED', removedAt: new Date() })).resolves.toBeTruthy();
    await expect(set({ status: 'ACTIVE', removedAt: null })).rejects.toThrow(/stays removed/);
    await expect(set({ isDefault: true })).rejects.toThrow(/check constraint/i); // only an active one is the default
  });

  it('are never deleted by the app, and are invisible to another firm', async () => {
    const saved = await method();
    await expect(
      firmA().clientPaymentMethod.deleteMany({ where: { id: saved.id } }),
    ).rejects.toThrow(/permission denied/i);
    const b = await runInScope(owner, { kind: 'business', businessId: f.firmB }, async (tx) => {
      const client = await tx.client.create({ data: { businessId: f.firmB, displayName: 'B3' } });
      return tx.clientPaymentMethod.create({
        data: {
          businessId: f.firmB,
          clientId: client.id,
          customerRef: `cus_${stripeId()}`,
          methodRef: `pm_${stripeId()}`,
          accountId: accounts.B,
          methodType: 'card',
          cardBrand: 'visa',
          last4: '1234',
          authorizedAt: new Date(),
        },
      });
    });
    await expectInvisibleToOtherFirm(app, f.firmA, f.firmB, ['client_payment_methods']);
    await expect(
      firmB().clientPaymentMethod.create({
        data: {
          ...A(),
          clientId: f.client,
          customerRef: `cus_${stripeId()}`,
          methodRef: `pm_${stripeId()}`,
          accountId: accounts.A,
          methodType: 'card',
          cardBrand: 'visa',
          last4: '1234',
          authorizedAt: new Date(),
        },
      }),
    ).rejects.toThrow(/row-level security|own Stripe account/i);
    expect(b.accountId).toBe(accounts.B);
  });
});
