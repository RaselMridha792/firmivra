// R36 (Invoices and Payments, r36_payments_extras): Record Payment's other methods and "Deposit
// To", how a Stripe payment was made and its tip, the payment a receipt event is about, the firm's
// deposit accounts and the files sent with an invoice. Runs as the app role under RLS.
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
const boss = randomUUID();
const ids = { otherClient: '', engagement: '', otherEngagement: '' };
const stripeId = () => randomUUID().replace(/-/g, '');
const account = `acct_${stripeId()}`;
let count = 0;
const A = () => ({ businessId: f.firmA });
const firmA = () => db.forBusiness(f.firmA);
const firmB = () => db.forBusiness(f.firmB);
const asBoss = () => db.forBusiness(f.firmA, { actorUserId: boss });

/** An issued invoice for `cents` (one line). */
async function openInvoice(cents = 10000) {
  const inv = await firmA().invoice.create({
    data: { ...A(), clientId: f.client, number: `INV-${++count}` },
  });
  await firmA().invoiceLine.create({
    data: { ...A(), invoiceId: inv.id, description: 'Service', unitAmountCents: cents },
  });
  return firmA().invoice.update({
    where: { id: inv.id },
    data: { status: 'OPEN', issuedAt: new Date() },
  });
}
const record = (invoiceId: string, data: Record<string, unknown> = {}) =>
  asBoss().offlinePayment.create({
    data: {
      ...A(),
      invoiceId,
      amountCents: 1000,
      method: 'ACH',
      receivedOn: new Date('2026-10-01'),
      idempotencyKey: randomUUID(),
      recordedByUserId: boss,
      ...data,
    },
  });
const pay = (invoiceId: string, data: Record<string, unknown> = {}) =>
  firmA().payment.create({
    data: {
      ...A(),
      invoiceId,
      amountCents: 1000,
      processorRef: `cs_${stripeId()}`,
      accountId: account,
      ...data,
    },
  });
const deposit = (data: Record<string, unknown> = {}) =>
  firmA().depositAccount.create({ data: { ...A(), name: `Account ${++count}`, ...data } });
const document = (clientId: string, engagementId: string, data: Record<string, unknown> = {}) =>
  firmA().document.create({
    data: {
      ...A(),
      clientId,
      engagementId,
      direction: 'FIRM_TO_CLIENT',
      fileName: 'letter.pdf',
      contentType: 'application/pdf',
      sizeBytes: 1024,
      sha256: 'c'.repeat(64),
      s3Key: `tenant/${f.firmA}/documents/${randomUUID()}`,
      ...data,
    },
  });
const clean = (id: string) =>
  firmA().document.update({ where: { id }, data: { scanStatus: 'CLEAN', scannedAt: new Date() } });

beforeAll(async () => {
  f = await createFirms(owner, 'px');
  await runInScope(owner, { kind: 'platform' }, async (tx) => {
    await tx.user.create({
      data: {
        id: boss,
        cognitoSub: boss,
        pool: 'STAFF',
        email: `b-${f.run}@px.test`,
        name: 'Fake Owner',
      },
    });
    await tx.stripeAccount.create({
      data: {
        ...A(),
        accountId: account,
        onboardingStatus: 'COMPLETE',
        chargesEnabled: true,
        payoutsEnabled: true,
      },
    });
  });
  await runInScope(owner, { kind: 'business', businessId: f.firmA }, async (tx) => {
    await tx.membership.create({ data: { ...A(), userId: boss, role: 'OWNER', status: 'ACTIVE' } });
    ids.otherClient = (await tx.client.create({ data: { ...A(), displayName: 'Other' } })).id;
    const service = await tx.service.create({ data: { ...A(), kind: 'OTHER', name: 'Svc' } });
    for (const [key, clientId] of [
      ['engagement', f.client],
      ['otherEngagement', ids.otherClient],
    ] as const) {
      ids[key] = (
        await tx.engagement.create({
          data: { ...A(), clientId, serviceId: service.id, title: 'E' },
        })
      ).id;
    }
  });
});

afterAll(async () => {
  await Promise.all([owner.$disconnect(), app.$disconnect(), db.disconnect()]);
});

describe('offline payments by other methods, deposited to an account', () => {
  it('records a bank transfer, a card terminal payment or another way, with the account', async () => {
    const account1 = await deposit();
    for (const method of ['ACH', 'CARD', 'OTHER'] as const) {
      const inv = await openInvoice();
      await expect(
        record(inv.id, { method, reference: 'REF123', depositAccountId: account1.id }),
      ).resolves.toMatchObject({ method, depositAccountId: account1.id });
    }
  });

  it('needs no reference for them (a check still needs its number)', async () => {
    const inv = await openInvoice();
    await expect(record(inv.id)).resolves.toMatchObject({
      reference: null,
      depositAccountId: null,
    });
    await expect(record(inv.id, { method: 'CHECK' })).rejects.toThrow(/check constraint/i);
  });

  it("refuses another firm's account and an archived one, and the account is fixed once recorded", async () => {
    const inv = await openInvoice();
    const theirs = await firmB().depositAccount.create({
      data: { businessId: f.firmB, name: 'B bank' },
    });
    await expect(record(inv.id, { depositAccountId: theirs.id })).rejects.toThrow(/foreign key/i);
    const old = await deposit({ archivedAt: new Date() });
    await expect(record(inv.id, { depositAccountId: old.id })).rejects.toThrow(
      /archived deposit account/,
    );
    const live = await deposit();
    const row = await record(inv.id, { depositAccountId: live.id });
    await expect(
      asBoss().offlinePayment.update({ where: { id: row.id }, data: { depositAccountId: null } }),
    ).rejects.toThrow(/never changes/);
  });
});

describe('deposit accounts', () => {
  it('names are bounded and unique per firm; a default is live; one live default', async () => {
    await expect(deposit({ name: '  ' })).rejects.toThrow(/check constraint/i);
    await expect(deposit({ name: 'x'.repeat(81) })).rejects.toThrow(/check constraint/i);
    await expect(deposit({ isDefault: true, archivedAt: new Date() })).rejects.toThrow(
      /check constraint/i,
    );
    const solo = await runInScope(owner, { kind: 'platform' }, (tx) =>
      tx.business.create({ data: { slug: `px-c-${f.run}`, name: 'C' } }),
    );
    const c = db.forBusiness(solo.id);
    const base = { businessId: solo.id };
    await c.depositAccount.create({ data: { ...base, name: 'One', isDefault: true } });
    await expect(
      c.depositAccount.create({ data: { ...base, name: 'Two', isDefault: true } }),
    ).rejects.toThrow(/unique/i);
    await expect(c.depositAccount.create({ data: { ...base, name: 'One' } })).rejects.toThrow(
      /unique/i,
    );
    await expect(
      firmB().depositAccount.create({ data: { businessId: f.firmB, name: 'One' } }),
    ).resolves.toBeTruthy();
  });

  it('are never deleted by the app', async () => {
    const d = await deposit();
    await expect(firmA().depositAccount.deleteMany({ where: { id: d.id } })).rejects.toThrow(
      /permission denied/i,
    );
  });
});

describe('how a Stripe payment was made', () => {
  it('keeps the method, brand and last 4 digits as the screen shows them, never more', async () => {
    const inv = await openInvoice();
    const p = await pay(inv.id, {
      methodType: 'card',
      cardBrand: 'visa',
      last4: '4242',
      tipCents: 200,
    });
    expect(p).toMatchObject({
      methodType: 'card',
      cardBrand: 'visa',
      last4: '4242',
      tipCents: 200,
    });
    const make = (data: Record<string, unknown>) => pay(inv.id, data);
    await expect(make({ cardBrand: 'visa' })).rejects.toThrow(/check constraint/i); // brand needs the card type
    await expect(make({ methodType: 'us_bank_account', cardBrand: 'visa' })).rejects.toThrow(
      /check constraint/i,
    );
    await expect(make({ methodType: 'card', last4: '42424' })).rejects.toThrow(/check constraint/i);
    await expect(make({ last4: '4242' })).rejects.toThrow(/check constraint/i);
    await expect(make({ methodType: 'Card Number 4242' })).rejects.toThrow(/check constraint/i);
    await expect(make({ tipCents: -1 })).rejects.toThrow(/check constraint/i);
    await expect(make({ methodType: 'us_bank_account', last4: '6789' })).resolves.toBeTruthy();
  });

  it('are set once: the tip never changes, a known method is not rewritten, an unknown one is filled in', async () => {
    const inv = await openInvoice();
    const p = await pay(inv.id, { tipCents: 100 });
    const set = (data: Record<string, unknown>) =>
      firmA().payment.update({ where: { id: p.id }, data });
    await expect(set({ tipCents: 0 })).rejects.toThrow(/set once/);
    await expect(
      set({ methodType: 'card', cardBrand: 'mastercard', last4: '4444' }),
    ).resolves.toBeTruthy();
    await expect(set({ last4: '1111' })).rejects.toThrow(/set once/);
    await expect(set({ methodType: 'us_bank_account' })).rejects.toThrow(/set once/);
  });
});

describe('invoice events about a payment', () => {
  const event = (invoiceId: string, data: Record<string, unknown>) =>
    firmA().invoiceEvent.create({
      data: { ...A(), invoiceId, type: 'RECEIPT_SENT', actorUserId: boss, ...data },
    });

  it('name the payment a receipt is for, a Stripe one or an offline one, never both', async () => {
    const inv = await openInvoice();
    const offline = await record(inv.id);
    const stripe = await pay(inv.id);
    await expect(event(inv.id, { offlinePaymentId: offline.id })).resolves.toBeTruthy();
    await expect(event(inv.id, { paymentId: stripe.id })).resolves.toBeTruthy();
    await expect(
      event(inv.id, { paymentId: stripe.id, offlinePaymentId: offline.id }),
    ).rejects.toThrow(/check constraint/i);
  });

  it("cannot name another firm's payment", async () => {
    const inv = await openInvoice();
    await expect(event(inv.id, { paymentId: randomUUID() })).rejects.toThrow(/foreign key/i);
  });
});

describe('invoice attachments', () => {
  const attach = (invoiceId: string, documentId: string) =>
    firmA().invoiceAttachment.create({
      data: { ...A(), invoiceId, documentId, addedByUserId: boss },
    });
  const draft = () =>
    firmA().invoice.create({ data: { ...A(), clientId: f.client, number: `INV-${++count}` } });

  it("take the invoice client's own clean, shared document, once", async () => {
    const inv = await draft();
    const doc = await document(f.client, ids.engagement);
    await expect(attach(inv.id, doc.id)).rejects.toThrow(/clean, shared document/); // still PENDING
    await clean(doc.id);
    await expect(attach(inv.id, doc.id)).resolves.toBeTruthy();
    await expect(attach(inv.id, doc.id)).rejects.toThrow(/unique/i);
  });

  it("refuse another client's document and an internal one", async () => {
    const inv = await draft();
    const theirs = await clean((await document(ids.otherClient, ids.otherEngagement)).id);
    await expect(attach(inv.id, theirs.id)).rejects.toThrow(/clean, shared document/);
    const internal = await clean(
      (await document(f.client, ids.engagement, { direction: 'INTERNAL' })).id,
    );
    await expect(attach(inv.id, internal.id)).rejects.toThrow(/clean, shared document/);
  });

  it('change only while the invoice can: removable on a draft, frozen once canceled', async () => {
    const inv = await draft();
    const doc = await clean((await document(f.client, ids.engagement)).id);
    const row = await attach(inv.id, doc.id);
    await firmA().invoiceAttachment.delete({ where: { id: row.id } });
    const again = await attach(inv.id, doc.id);
    await firmA().invoice.update({
      where: { id: inv.id },
      data: { status: 'CANCELED', canceledAt: new Date() },
    });
    await expect(firmA().invoiceAttachment.delete({ where: { id: again.id } })).rejects.toThrow(
      /keeps its files/,
    );
    const other = await clean((await document(f.client, ids.engagement)).id);
    await expect(attach(inv.id, other.id)).rejects.toThrow(/keeps its files/);
  });
});

describe('isolation between firms', () => {
  it('deposit accounts and invoice attachments are invisible to another firm', async () => {
    await deposit();
    await firmB().depositAccount.create({ data: { businessId: f.firmB, name: `B ${f.run}` } });
    const inv = await firmA().invoice.create({
      data: { ...A(), clientId: f.client, number: `INV-${++count}` },
    });
    const doc = await clean((await document(f.client, ids.engagement)).id);
    await firmA().invoiceAttachment.create({
      data: { ...A(), invoiceId: inv.id, documentId: doc.id },
    });
    await expectInvisibleToOtherFirm(app, f.firmA, f.firmB, ['deposit_accounts']);
    const seen = await runInScope(app, { kind: 'business', businessId: f.firmB }, (tx) =>
      tx.$queryRawUnsafe<{ n: number }[]>('SELECT count(*)::int AS n FROM invoice_attachments'),
    );
    expect(seen[0]?.n).toBe(0);
    await expect(
      firmB().depositAccount.create({ data: { ...A(), name: `Sneaky ${f.run}` } }),
    ).rejects.toThrow(/row-level security/i);
    await expect(
      firmB().invoiceAttachment.create({
        data: { businessId: f.firmB, invoiceId: inv.id, documentId: doc.id },
      }),
    ).rejects.toThrow(/foreign key|keeps its files/i);
  });
});
