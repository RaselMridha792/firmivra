// Invoices to a client: the firm's invoice routes and refunds, and the portal's own invoices and
// Pay Now.
import { randomUUID } from 'node:crypto';
import type { CaseModule, SeedContext } from '../world.js';

const day = (days: number) => new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);
const ref = () => randomUUID().replace(/-/g, '');

async function openInvoice({ tx, businessId, get }: SeedContext): Promise<string> {
  const row = await tx.invoice.create({
    data: {
      businessId,
      clientId: await get('client'),
      number: `ISO-${randomUUID().slice(0, 8)}`,
      dueOn: new Date(`${day(30)}T00:00:00.000Z`),
    },
  });
  await tx.invoiceLine.create({
    data: { businessId, invoiceId: row.id, description: 'Fake service', unitAmountCents: 10_000 },
  });
  await tx.invoice.update({
    where: { id: row.id },
    data: { status: 'OPEN', issuedAt: new Date() },
  });
  return row.id;
}

export const records: CaseModule['records'] = {
  /** A draft invoice to client X. */
  invoice: {
    clientPrivate: true,
    async create({ tx, businessId, get }) {
      const row = await tx.invoice.create({
        data: {
          businessId,
          clientId: await get('client'),
          number: `ISO-${randomUUID().slice(0, 8)}`,
        },
      });
      return row.id;
    },
  },
  /** An open invoice of 100.00 to client X, sent today. */
  openInvoice: { clientPrivate: true, create: openInvoice },
  /** Another one, for the checkout below (cash cannot be recorded while a checkout is open). */
  checkoutInvoice: { clientPrivate: true, create: openInvoice },
  /** A Pay Now checkout the client opened on the open invoice and left (PENDING). */
  payment: {
    clientPrivate: true,
    async create({ tx, businessId, get }) {
      // A payment needs the firm's own account taking charges when it starts; the account is
      // turned off again after, so Pay Now below still answers 409.
      const account = {
        chargesEnabled: true,
        detailsSubmitted: true,
        onboardingStatus: 'RESTRICTED',
      } as const;
      // Upsert: each test seeds its records again in the same firm.
      const { accountId } = await tx.stripeAccount.upsert({
        where: { businessId },
        create: { businessId, accountId: `acct_iso${ref().slice(0, 12)}`, ...account },
        update: account,
      });
      const row = await tx.payment.create({
        data: {
          businessId,
          invoiceId: await get('checkoutInvoice'),
          amountCents: 10_000,
          currency: 'usd',
          processorRef: `cs_test_${ref()}`,
          accountId,
        },
      });
      await tx.stripeAccount.update({
        where: { businessId },
        data: { chargesEnabled: false, onboardingStatus: 'RESTRICTED' },
      });
      return row.id;
    },
  },
};

export const cases: CaseModule['cases'] = {
  'GET /api/v1/business/invoices/:id': { params: { id: 'invoice' } },
  'PUT /api/v1/business/invoices/:id': {
    params: { id: 'invoice' },
    body: { lines: [{ description: 'Fake service', unitAmountCents: 5_000 }], dueOn: day(20) },
  },
  // Found, but a draft with no lines has nothing to pay.
  'POST /api/v1/business/invoices/:id/send': { params: { id: 'invoice' }, expect: 409 },
  'POST /api/v1/business/invoices/:id/cancel': {
    params: { id: 'invoice' },
    body: { reason: 'Billed by mistake' },
  },
  // Found, but a checkout that is not paid is not refundable.
  'POST /api/v1/business/invoices/:id/payments/:paymentId/refunds': {
    params: { id: 'checkoutInvoice', paymentId: 'payment' },
    body: () => ({ amountCents: 100, idempotencyKey: randomUUID() }),
    expect: 409,
  },
  'GET /api/v1/portal/:firmSlug/me/invoices/:id': { params: { id: 'openInvoice' } },
  // Found, but firm P has no Stripe account that takes charges.
  'POST /api/v1/portal/:firmSlug/me/invoices/:id/checkout': {
    params: { id: 'openInvoice' },
    body: {},
    expect: 409,
  },
};
