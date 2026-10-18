// Demo seed, stage 2 (R0, PART 2): invoices in every state the Invoices screens and the portal
// Invoices tab show -- draft, scheduled, open, overdue, part paid, paid and canceled. Paid and part
// paid invoices are settled with recorded offline payments (check, ACH, card in person): the
// database takes those only from the acting Owner or Admin, so this module runs with the owner as
// the actor, and it needs no Stripe account. An invoice already present is left as it is.
import { runInScope, type createPrismaClient } from '../src/client.js';
import { demoId, SEED_DEMO_USERS } from './seed-demo-data.js';
import {
  demoDay,
  demoEngagement,
  demoEngagementId,
  type DemoEngagementSlot,
} from './seed-demo-engagements.js';
import type { DemoOrgResult } from './seed-demo-org.js';

type Prisma = ReturnType<typeof createPrismaClient>;

type InvoiceState = 'DRAFT' | 'SCHEDULED' | 'OPEN' | 'OVERDUE' | 'PARTIAL' | 'PAID' | 'CANCELED';

interface DemoInvoice {
  number: string;
  clientKey: string;
  slot: DemoEngagementSlot;
  state: InvoiceState;
  line: string;
  cents: number;
  /** Days from today: when it was issued (or is scheduled for) and when it is due. */
  issued: number;
  due: number;
  method?: 'CHECK' | 'ACH' | 'CARD' | 'CASH';
}

const INVOICES: readonly DemoInvoice[] = [
  {
    number: 'INV-2001',
    clientKey: '01',
    slot: 'tax2024',
    state: 'PAID',
    line: '2024 Individual Tax Return',
    cents: 45000,
    issued: -200,
    due: -186,
    method: 'CARD',
  },
  {
    number: 'INV-2002',
    clientKey: '01',
    slot: 'tax2025',
    state: 'OPEN',
    line: '2025 Individual Tax Return (deposit)',
    cents: 22500,
    issued: -5,
    due: 25,
  },
  {
    number: 'INV-2003',
    clientKey: '01',
    slot: 'planning',
    state: 'OVERDUE',
    line: '2026 Tax Planning',
    cents: 60000,
    issued: -40,
    due: -10,
  },
  {
    number: 'INV-2004',
    clientKey: '04',
    slot: 'books',
    state: 'PAID',
    line: 'Bookkeeping (Starter), September',
    cents: 25000,
    issued: -45,
    due: -31,
    method: 'ACH',
  },
  {
    number: 'INV-2005',
    clientKey: '04',
    slot: 'books',
    state: 'OPEN',
    line: 'Bookkeeping (Starter), October',
    cents: 25000,
    issued: -14,
    due: 16,
  },
  {
    number: 'INV-2006',
    clientKey: '07',
    slot: 'books',
    state: 'PAID',
    line: 'Bookkeeping (Growth), September',
    cents: 35000,
    issued: -45,
    due: -31,
    method: 'CHECK',
  },
  {
    number: 'INV-2007',
    clientKey: '07',
    slot: 'books',
    state: 'PARTIAL',
    line: 'Bookkeeping (Growth), October',
    cents: 35000,
    issued: -14,
    due: 16,
    method: 'CHECK',
  },
  {
    number: 'INV-2008',
    clientKey: '04',
    slot: 'payroll',
    state: 'OVERDUE',
    line: 'Payroll processing, September',
    cents: 18000,
    issued: -50,
    due: -20,
  },
  {
    number: 'INV-2009',
    clientKey: '10',
    slot: 'books',
    state: 'PAID',
    line: 'Bookkeeping (Premium), September',
    cents: 55000,
    issued: -45,
    due: -31,
    method: 'ACH',
  },
  {
    number: 'INV-2010',
    clientKey: '07',
    slot: 'quarterly',
    state: 'OPEN',
    line: 'Q3 estimated tax calculation',
    cents: 15000,
    issued: -3,
    due: 27,
  },
  {
    number: 'INV-2011',
    clientKey: '13',
    slot: 'books',
    state: 'OVERDUE',
    line: 'Bookkeeping (Starter), August',
    cents: 25000,
    issued: -75,
    due: -45,
  },
  {
    number: 'INV-2012',
    clientKey: '10',
    slot: 'payroll',
    state: 'PAID',
    line: 'Payroll processing, September',
    cents: 18000,
    issued: -45,
    due: -31,
    method: 'CHECK',
  },
  {
    number: 'INV-2013',
    clientKey: '16',
    slot: 'books',
    state: 'SCHEDULED',
    line: 'Bookkeeping (Growth), November',
    cents: 35000,
    issued: 14,
    due: 44,
  },
  {
    number: 'INV-2014',
    clientKey: '13',
    slot: 'quarterly',
    state: 'PAID',
    line: 'Q2 estimated tax calculation',
    cents: 15000,
    issued: -100,
    due: -86,
    method: 'CASH',
  },
  {
    number: 'INV-2015',
    clientKey: '19',
    slot: 'books',
    state: 'OPEN',
    line: 'Bookkeeping (Premium), October',
    cents: 55000,
    issued: -10,
    due: 20,
  },
  {
    number: 'INV-2016',
    clientKey: '22',
    slot: 'books',
    state: 'DRAFT',
    line: 'Bookkeeping (Starter), October',
    cents: 25000,
    issued: 0,
    due: 30,
  },
  {
    number: 'INV-2017',
    clientKey: '25',
    slot: 'books',
    state: 'OVERDUE',
    line: 'Bookkeeping (Growth), September',
    cents: 35000,
    issued: -45,
    due: -15,
  },
  {
    number: 'INV-2018',
    clientKey: '03',
    slot: 'tax2024',
    state: 'PAID',
    line: '2024 Individual Tax Return',
    cents: 38000,
    issued: -190,
    due: -176,
    method: 'CARD',
  },
  {
    number: 'INV-2019',
    clientKey: '11',
    slot: 'planning',
    state: 'DRAFT',
    line: '2026 Tax Planning',
    cents: 60000,
    issued: 0,
    due: 30,
  },
  {
    number: 'INV-2020',
    clientKey: '23',
    slot: 'tax2025',
    state: 'CANCELED',
    line: '2025 Individual Tax Return',
    cents: 42000,
    issued: -30,
    due: 0,
  },
  {
    number: 'INV-2021',
    clientKey: '15',
    slot: 'tax2025',
    state: 'OPEN',
    line: '2025 Individual Tax Return (deposit)',
    cents: 20000,
    issued: -2,
    due: 28,
  },
];

export async function seedDemoBilling(prisma: Prisma, org: DemoOrgResult): Promise<void> {
  const { businessId } = org;
  const ownerId = SEED_DEMO_USERS.owner.id;

  await runInScope(prisma, { kind: 'business', businessId, actorUserId: ownerId }, async (tx) => {
    for (const inv of INVOICES) {
      const engagement = demoEngagement(inv.clientKey, inv.slot);
      const id = demoId(`invoice:${inv.number}`);
      if (await tx.invoice.findUnique({ where: { id } })) continue;

      await tx.invoice.create({
        data: {
          id,
          businessId,
          clientId: org.clients[inv.clientKey]!,
          engagementId: demoEngagementId(inv.clientKey, inv.slot),
          number: inv.number,
          createdByUserId: ownerId,
          assignedUserId: SEED_DEMO_USERS[engagement.assigned].id,
          paymentTerms: 'net_30',
          notesToClient: 'Thank you for your business.',
        },
      });
      await tx.invoiceLine.create({
        data: {
          businessId,
          invoiceId: id,
          serviceId: org.serviceIds(engagement.service),
          itemName: engagement.service,
          description: inv.line,
          unitAmountCents: inv.cents,
        },
      });

      if (inv.state === 'DRAFT') {
        await tx.invoice.update({ where: { id }, data: { dueOn: demoDay(inv.due) } });
        continue;
      }
      if (inv.state === 'SCHEDULED') {
        await tx.invoice.update({
          where: { id },
          data: { status: 'SCHEDULED', scheduledFor: demoDay(inv.issued), dueOn: demoDay(inv.due) },
        });
        continue;
      }

      await tx.invoice.update({
        where: { id },
        data: { status: 'OPEN', issuedAt: demoDay(inv.issued), dueOn: demoDay(inv.due) },
      });

      if (inv.state === 'PAID' || inv.state === 'PARTIAL') {
        const amountCents = inv.state === 'PAID' ? inv.cents : Math.round(inv.cents * 0.4);
        const receivedOn = demoDay(Math.min(inv.due - 3, -1));
        await tx.offlinePayment.create({
          data: {
            id: demoId(`offline-payment:${inv.number}`),
            businessId,
            invoiceId: id,
            method: inv.method ?? 'CHECK',
            amountCents,
            reference: inv.method === 'CHECK' ? `${1000 + Number(inv.number.slice(-2))}` : null,
            receivedOn,
            idempotencyKey: demoId(`offline-payment-key:${inv.number}`),
            recordedByUserId: ownerId,
          },
        });
        if (inv.state === 'PAID') {
          await tx.invoice.update({
            where: { id },
            data: { status: 'PAID', paidAt: receivedOn },
          });
        }
      }
      if (inv.state === 'CANCELED') {
        await tx.invoice.update({
          where: { id },
          data: {
            status: 'CANCELED',
            canceledAt: demoDay(-20),
            cancelReason: 'Engagement cancelled before work began.',
          },
        });
      }
    }
  });
}
