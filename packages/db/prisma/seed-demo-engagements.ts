// Demo seed, stage 2 (R0, PART 2): engagements for every demo client (individual tax returns,
// bookkeeping, payroll, quarterly tax, planning), with tasks in every status and progress, staff
// notes, and the tax returns the portal Taxes tab and the Tax Returns screens read. DEMO_ENGAGEMENTS
// is the plan the other stage 2 modules (billing, calendar, documents, messages) point at; every
// id is demoId-derived, so a module needs only the plan, not another module's return value.
import { runInScope, type createPrismaClient } from '../src/client.js';
import { demoId, SEED_DEMO_CLIENTS, SEED_DEMO_USERS, type DemoStaffKey } from './seed-demo-data.js';
import type { DemoOrgResult } from './seed-demo-org.js';

type Prisma = ReturnType<typeof createPrismaClient>;

const DAY_MS = 24 * 60 * 60 * 1000;
/** Midnight UTC today. Dates are relative to the day the seed runs, so the demo always looks current. */
export const demoToday = (): Date => new Date(Math.floor(Date.now() / DAY_MS) * DAY_MS);
/** A date `offset` days from today (negative: in the past). */
export const demoDay = (offset: number): Date => new Date(demoToday().getTime() + offset * DAY_MS);

export type DemoEngagementSlot =
  'tax2025' | 'tax2024' | 'books' | 'payroll' | 'quarterly' | 'planning';

export interface DemoEngagement {
  id: string;
  clientKey: string;
  slot: DemoEngagementSlot;
  service: string;
  title: string;
  status: 'PENDING' | 'ACTIVE' | 'COMPLETED' | 'CANCELLED';
  stage: string | null;
  taxYear: number | null;
  billingInterval: 'ONE_TIME' | 'MONTHLY' | 'QUARTERLY' | 'YEARLY';
  package: string | null;
  assigned: DemoStaffKey;
}

const engagementIdFor = (clientKey: string, slot: DemoEngagementSlot): string =>
  demoId(`engagement:${clientKey}:${slot}`);

/** The planned engagement for a client and slot; throws if the plan has none (a typo in a module). */
export const demoEngagement = (clientKey: string, slot: DemoEngagementSlot): DemoEngagement => {
  const found = DEMO_ENGAGEMENTS.find((e) => e.clientKey === clientKey && e.slot === slot);
  if (!found) throw new Error(`demo seed: client ${clientKey} has no ${slot} engagement`);
  return found;
};

/** Its id (checked against the plan). */
export const demoEngagementId = (clientKey: string, slot: DemoEngagementSlot): string =>
  demoEngagement(clientKey, slot).id;

const TAX_STAGES = ['New', 'Missing documents', 'Preparation', 'Review', 'Signature'] as const;
const BOOKS_STAGES = ['Onboarding', 'Monthly close', 'Review'] as const;
const PACKAGES = ['Starter', 'Growth', 'Premium'] as const;

/** Every demo engagement, by client. Built once from SEED_DEMO_CLIENTS so the mix is deterministic. */
export const DEMO_ENGAGEMENTS: readonly DemoEngagement[] = SEED_DEMO_CLIENTS.flatMap((c, i) => {
  const list: DemoEngagement[] = [];
  const add = (e: Omit<DemoEngagement, 'id' | 'clientKey'>) =>
    list.push({ ...e, id: engagementIdFor(c.key, e.slot), clientKey: c.key });
  const individual = c.accountType === 'INDIVIDUAL';

  // This year's return: mostly in progress at every stage; a few not started yet, one cancelled.
  const pending = i % 9 === 4;
  const cancelled = c.key === '23';
  add({
    slot: 'tax2025',
    service: 'Annual Tax',
    title: individual ? '2025 Individual Tax' : '2025 Business Tax Return',
    status: cancelled ? 'CANCELLED' : pending ? 'PENDING' : 'ACTIVE',
    stage: pending ? 'New' : TAX_STAGES[i % TAX_STAGES.length]!,
    taxYear: 2025,
    billingInterval: 'ONE_TIME',
    package: null,
    assigned: individual ? (i % 2 === 0 ? 'taxPreparer' : 'manager') : 'manager',
  });
  // Last year's return, done and filed, for about half the clients.
  if (i % 2 === 0) {
    add({
      slot: 'tax2024',
      service: 'Annual Tax',
      title: individual ? '2024 Individual Tax' : '2024 Business Tax Return',
      status: 'COMPLETED',
      stage: null,
      taxYear: 2024,
      billingInterval: 'ONE_TIME',
      package: null,
      assigned: 'taxPreparer',
    });
  }
  if (!individual) {
    // Varied by the client's position among business clients only (b), not among all clients.
    const b = SEED_DEMO_CLIENTS.slice(0, i).filter((x) => x.accountType === 'BUSINESS').length;
    const pkg = PACKAGES[b % PACKAGES.length]!;
    add({
      slot: 'books',
      service: 'Bookkeeping',
      title: `Bookkeeping (${pkg})`,
      status: 'ACTIVE',
      stage: BOOKS_STAGES[b % BOOKS_STAGES.length]!,
      taxYear: null,
      billingInterval: 'MONTHLY',
      package: pkg,
      assigned: 'bookkeeper',
    });
    if (b % 2 === 0) {
      add({
        slot: 'payroll',
        service: 'Payroll',
        title: 'Payroll',
        status: 'ACTIVE',
        stage: 'Running',
        taxYear: null,
        billingInterval: 'MONTHLY',
        package: null,
        assigned: 'bookkeeper',
      });
    }
    if (b % 2 === 1) {
      add({
        slot: 'quarterly',
        service: 'Quarterly Tax',
        title: '2026 Quarterly Estimates',
        status: 'ACTIVE',
        stage: 'Collecting figures',
        taxYear: 2026,
        billingInterval: 'QUARTERLY',
        package: null,
        assigned: 'manager',
      });
    }
  }
  // Two individuals also have a planning engagement.
  if (c.key === '01' || c.key === '11') {
    add({
      slot: 'planning',
      service: 'Tax Planning',
      title: '2026 Tax Planning',
      status: 'ACTIVE',
      stage: c.key === '01' ? 'Projection' : 'Discovery',
      taxYear: 2026,
      billingInterval: 'YEARLY',
      package: null,
      assigned: 'manager',
    });
  }
  return list;
});

const TASK_TITLES: Record<DemoEngagementSlot, readonly string[]> = {
  tax2025: [
    'Collect W-2s and 1099s',
    'Review prior-year return for carryovers',
    'Confirm dependents and filing status',
    'Prepare draft return',
    'Partner review of draft',
    'Send e-file authorization (Form 8879)',
  ],
  tax2024: ['Archive filed return and workpapers'],
  books: [
    'Reconcile operating account',
    'Categorize uncoded transactions',
    'Send monthly financials',
    'Follow up on missing receipts',
  ],
  payroll: ['Run bi-weekly payroll', 'File quarterly 941'],
  quarterly: ['Calculate Q4 estimate', 'Send payment voucher'],
  planning: ['Build income projection', 'Model retirement contribution scenarios'],
};

type TaskShape = {
  status: 'OPEN' | 'DONE' | 'CANCELLED';
  progress: 'NOT_STARTED' | 'PENDING' | 'IN_PROGRESS' | 'WAITING' | 'BLOCKED';
  priority: 'LOW' | 'MEDIUM' | 'HIGH';
  due: number;
  blockedReason?: string;
};
/** Cycled across tasks: open work at every progress, some overdue, plus done and cancelled. */
const TASK_SHAPES: readonly TaskShape[] = [
  { status: 'OPEN', progress: 'IN_PROGRESS', priority: 'HIGH', due: 2 },
  { status: 'OPEN', progress: 'NOT_STARTED', priority: 'MEDIUM', due: 7 },
  { status: 'OPEN', progress: 'WAITING', priority: 'MEDIUM', due: 4 },
  { status: 'DONE', progress: 'IN_PROGRESS', priority: 'MEDIUM', due: -6 },
  { status: 'OPEN', progress: 'PENDING', priority: 'LOW', due: 14 },
  { status: 'OPEN', progress: 'IN_PROGRESS', priority: 'HIGH', due: -3 },
  {
    status: 'OPEN',
    progress: 'BLOCKED',
    priority: 'HIGH',
    due: 1,
    blockedReason: 'Waiting on the client to send the missing statement.',
  },
  { status: 'DONE', progress: 'IN_PROGRESS', priority: 'LOW', due: -12 },
  { status: 'OPEN', progress: 'NOT_STARTED', priority: 'LOW', due: 21 },
  { status: 'CANCELLED', progress: 'NOT_STARTED', priority: 'LOW', due: -2 },
  { status: 'OPEN', progress: 'IN_PROGRESS', priority: 'MEDIUM', due: 0 },
];

const NOTES = [
  'Prefers email over phone; replies within a day.',
  'Expecting a K-1 from a partnership this year; it usually arrives in March.',
  'Moved mid-year; may owe a part-year state return.',
  'Asked about switching to an S corporation next year.',
  'Has a home office; confirm square footage again.',
  'Bank feed disconnected twice this quarter; reconnect before month end.',
  'Spouse handles the paperwork; copy both on emails.',
];

export async function seedDemoEngagements(prisma: Prisma, org: DemoOrgResult): Promise<void> {
  const { businessId } = org;
  const user = (key: DemoStaffKey) => SEED_DEMO_USERS[key].id;

  await runInScope(prisma, { kind: 'business', businessId }, async (tx) => {
    for (const e of DEMO_ENGAGEMENTS) {
      const clientId = org.clients[e.clientKey]!;
      const completed = e.status === 'COMPLETED';
      const cancelled = e.status === 'CANCELLED';
      await tx.engagement.upsert({
        where: { id: e.id },
        update: {},
        create: {
          id: e.id,
          businessId,
          clientId,
          serviceId: org.serviceIds(e.service),
          title: e.title,
          taxYear: e.taxYear,
          package: e.package,
          stage: e.stage,
          status: e.status,
          billingInterval: e.billingInterval,
          assignedUserId: user(e.assigned),
          updatedByUserId: user(e.assigned),
          ...(e.billingInterval === 'MONTHLY'
            ? { periodStart: new Date('2026-01-01'), nextBillingOn: demoDay(15) }
            : {}),
          ...(completed ? { completedAt: new Date('2025-04-10T16:00:00Z') } : {}),
          ...(cancelled
            ? {
                cancelledAt: demoDay(-20),
                cancellationReason: 'Client moved to another preparer.',
              }
            : {}),
        },
      });
    }

    // Tasks: one or two per live engagement, cycling TASK_SHAPES, so every status, progress
    // and priority shows up, with some overdue and some due today.
    let n = 0;
    for (const e of DEMO_ENGAGEMENTS) {
      if (e.status === 'CANCELLED') continue;
      const titles = TASK_TITLES[e.slot];
      const count = e.status === 'COMPLETED' ? 1 : 2;
      for (let k = 0; k < count; k++) {
        const shape = TASK_SHAPES[n % TASK_SHAPES.length]!;
        const done = e.status === 'COMPLETED' ? true : shape.status === 'DONE';
        const id = demoId(`task:${e.clientKey}:${e.slot}:${k}`);
        n++;
        await tx.task.upsert({
          where: { id },
          update: {},
          create: {
            id,
            businessId,
            clientId: org.clients[e.clientKey]!,
            engagementId: e.id,
            title: titles[(k + n) % titles.length]!,
            status: done ? 'DONE' : shape.status,
            progress: shape.progress,
            priority: shape.priority,
            dueOn: e.status === 'COMPLETED' ? new Date('2025-04-08') : demoDay(shape.due),
            assignedUserId: user(e.assigned),
            createdByUserId: user('manager'),
            serviceId: org.serviceIds(e.service),
            ...(shape.blockedReason && !done ? { blockedReason: shape.blockedReason } : {}),
            ...(done
              ? {
                  completedAt:
                    e.status === 'COMPLETED'
                      ? new Date('2025-04-09T15:00:00Z')
                      : demoDay(shape.due + 1),
                  completedByUserId: user(e.assigned),
                }
              : {}),
          },
        });
      }
    }

    // Staff notes on about a third of the clients.
    for (const [i, c] of SEED_DEMO_CLIENTS.entries()) {
      if (i % 3 !== 0) continue;
      const id = demoId(`note:${c.key}`);
      await tx.note.upsert({
        where: { id },
        update: {},
        create: {
          id,
          businessId,
          clientId: org.clients[c.key]!,
          engagementId: demoEngagementId(c.key, 'tax2025'),
          body: NOTES[i % NOTES.length]!,
          authorUserId: user(c.assigned),
        },
      });
    }

    // Tax returns: last year's filed and accepted, this year's in progress (the portal Taxes
    // tab and the firm's Tax Returns screens).
    for (const e of DEMO_ENGAGEMENTS) {
      if (e.slot !== 'tax2024' && e.slot !== 'tax2025') continue;
      if (e.status === 'CANCELLED' || e.status === 'PENDING') continue;
      const client = SEED_DEMO_CLIENTS.find((c) => c.key === e.clientKey)!;
      const individual = client.accountType === 'INDIVIDUAL';
      const id = demoId(`tax-return:${e.clientKey}:${e.taxYear}`);
      await tx.taxReturn.upsert({
        where: { id },
        update: {},
        create: {
          id,
          businessId,
          clientId: org.clients[e.clientKey]!,
          engagementId: e.id,
          taxYear: e.taxYear!,
          filingType: individual ? 'INDIVIDUAL' : 'BUSINESS',
          formType: individual ? '1040' : '1120-S',
          ...(e.slot === 'tax2024'
            ? { status: 'ACCEPTED' as const, filedOn: new Date('2025-04-10') }
            : {}),
        },
      });
    }
  });
}
