// Demo seed, stage 5 (R0, Oct 19): the Tasks module around the tasks stage 2 made. Task types (set
// on every demo task by its engagement), templates, recurring series with their due dates (one
// made, upcoming, one skipped), checklists (done on done tasks), collaborators, reminders, client
// documents attached to tasks, and the firm's tags on clients and leads. Synthetic data, the demo
// firm only; every row has a fixed id (demoId) or a natural key, so a re-run changes nothing.
import { runInScope, type createPrismaClient, type TxClient } from '../src/client.js';
import { demoId, SEED_DEMO_CLIENTS, SEED_DEMO_USERS, type DemoStaffKey } from './seed-demo-data.js';
import { demoDay, DEMO_ENGAGEMENTS, type DemoEngagementSlot } from './seed-demo-engagements.js';
import type { DemoOrgResult } from './seed-demo-org.js';

type Prisma = ReturnType<typeof createPrismaClient>;

const user = (key: DemoStaffKey) => SEED_DEMO_USERS[key].id;

/** The firm's task types, and which one each engagement slot's tasks get. */
const TYPES = [
  'Tax Preparation',
  'Bookkeeping',
  'Payroll',
  'Quarterly Estimates',
  'Tax Planning',
  'Document Collection',
  'Client Follow-up',
] as const;
type TypeName = (typeof TYPES)[number];
const TYPE_BY_SLOT: Readonly<Record<DemoEngagementSlot, TypeName>> = {
  tax2025: 'Tax Preparation',
  tax2024: 'Tax Preparation',
  books: 'Bookkeeping',
  payroll: 'Payroll',
  quarterly: 'Quarterly Estimates',
  planning: 'Tax Planning',
};

/** Checklist steps by task type (the first is required). */
const STEPS: Readonly<Record<TypeName, readonly string[]>> = {
  'Tax Preparation': [
    'Confirm every W-2 and 1099 is in',
    'Compare income with last year',
    'Review deductions with the client',
  ],
  Bookkeeping: [
    'Reconcile the bank and card accounts',
    'Categorize uncategorized transactions',
    'Send the monthly reports',
  ],
  Payroll: ['Check new hires and terminations', 'Approve the pay run', 'Confirm the tax deposit'],
  'Quarterly Estimates': [
    'Update year-to-date income',
    'Calculate the estimate',
    'Send the voucher',
  ],
  'Tax Planning': [
    'Review last year’s return',
    'Model the scenarios',
    'Write up the recommendations',
  ],
  'Document Collection': ['Send the document list', 'Follow up on missing items'],
  'Client Follow-up': ['Call the client', 'Log the outcome'],
};

const TEMPLATES = [
  {
    key: 'onboarding',
    name: 'New client onboarding',
    description: 'Welcome call, document list and portal setup for a new client.',
    type: 'Client Follow-up',
    service: null,
    priority: 'MEDIUM',
    dueOffsetDays: 7,
    checklist: [
      { label: 'Send the welcome email', required: true },
      { label: 'Book the welcome call' },
      { label: 'Invite the client to the portal', required: true },
    ],
    reminders: [{ daysBefore: 1, inApp: true, channels: [] }],
  },
  {
    key: 'annual-return',
    name: 'Annual return preparation',
    description: 'From the document request to the signed e-file authorization.',
    type: 'Tax Preparation',
    service: 'Annual Tax',
    priority: 'HIGH',
    dueOffsetDays: 30,
    checklist: [
      { label: 'Request the year’s documents', required: true },
      { label: 'Prepare the return', required: true },
      { label: 'Manager review' },
      { label: 'Send Form 8879 for signature', required: true },
    ],
    reminders: [
      { daysBefore: 7, inApp: true, channels: ['EMAIL'] },
      { daysBefore: 0, inApp: true, channels: [] },
    ],
  },
  {
    key: 'monthly-close',
    name: 'Monthly close',
    description: 'Reconcile, categorize and send the month’s reports.',
    type: 'Bookkeeping',
    service: 'Bookkeeping',
    priority: 'MEDIUM',
    dueOffsetDays: 10,
    checklist: [
      { label: 'Reconcile every account', required: true },
      { label: 'Clear the uncategorized list' },
      { label: 'Send the P&L and balance sheet', required: true },
    ],
    reminders: [{ daysBefore: 3, inApp: true, channels: ['EMAIL'] }],
  },
  {
    key: 'quarterly-estimate',
    name: 'Quarterly estimate',
    description: 'Work out and send the client’s estimated tax payment.',
    type: 'Quarterly Estimates',
    service: 'Quarterly Tax',
    priority: 'HIGH',
    dueOffsetDays: 14,
    checklist: [{ label: 'Calculate the estimate', required: true }, { label: 'Send the voucher' }],
    reminders: [{ daysBefore: 5, inApp: true, channels: ['EMAIL'] }],
  },
] as const;

const TAGS = [
  'VIP',
  'Extension Filed',
  'New This Year',
  'Back Taxes',
  'Needs Follow-up',
  'Referral Partner',
] as const;

/** First of the month, `months` from this month (UTC). */
const monthStart = (months: number) => {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + months, 1));
};
/** The 15th of the month, `months` from this month (UTC). */
const fifteenth = (months: number) => new Date(monthStart(months).getTime() + 14 * 86_400_000);

export async function seedDemoTasks(prisma: Prisma, org: DemoOrgResult): Promise<void> {
  const { businessId } = org;

  await runInScope(prisma, { kind: 'business', businessId }, async (tx) => {
    // Types, and each demo task's type from its engagement.
    const typeId = {} as Record<TypeName, string>;
    for (const [i, name] of TYPES.entries()) {
      const row = await tx.taskType.upsert({
        where: { businessId_name: { businessId, name } },
        update: {},
        create: { id: demoId(`task-type:${name}`), businessId, name, sortOrder: i },
      });
      typeId[name] = row.id;
    }
    for (const e of DEMO_ENGAGEMENTS) {
      await tx.task.updateMany({
        where: { businessId, engagementId: e.id, typeId: null },
        data: { typeId: typeId[TYPE_BY_SLOT[e.slot]] },
      });
    }

    for (const t of TEMPLATES) {
      await tx.taskTemplate.upsert({
        where: { businessId_name: { businessId, name: t.name } },
        update: {},
        create: {
          id: demoId(`task-template:${t.key}`),
          businessId,
          name: t.name,
          description: t.description,
          typeId: typeId[t.type],
          serviceId: t.service ? org.serviceIds(t.service) : null,
          priority: t.priority,
          dueOffsetDays: t.dueOffsetDays,
          checklist: t.checklist,
          reminders: t.reminders,
          createdByUserId: user('manager'),
        },
      });
    }

    await seedSeries(tx, org, typeId);
    await seedTaskParts(tx, businessId);
    await seedTags(tx, org);
  });
}

/**
 * Two recurring series on business clients' engagements: a monthly close on the 15th and the
 * quarterly estimates. Each has last month's due date made into a task, the next ones scheduled,
 * and the monthly one a skipped month.
 */
async function seedSeries(tx: TxClient, org: DemoOrgResult, typeId: Record<TypeName, string>) {
  const { businessId } = org;
  const books = DEMO_ENGAGEMENTS.find((e) => e.slot === 'books' && e.status === 'ACTIVE')!;
  const quarterly = DEMO_ENGAGEMENTS.find((e) => e.slot === 'quarterly' && e.status === 'ACTIVE')!;
  const series = [
    {
      key: 'monthly-close',
      engagement: books,
      service: 'Bookkeeping',
      type: 'Bookkeeping' as const,
      title: 'Monthly close',
      details: 'Reconcile every account and send the month’s reports.',
      interval: 1,
      unit: 'MONTH' as const,
      assigned: 'bookkeeper' as const,
      dates: [-1, 0, 1, 2],
      skipped: 0,
    },
    {
      key: 'quarterly-estimate',
      engagement: quarterly,
      service: 'Quarterly Tax',
      type: 'Quarterly Estimates' as const,
      title: 'Quarterly estimated tax payment',
      details: 'Work out the estimate from year-to-date income and send the voucher.',
      interval: 3,
      unit: 'MONTH' as const,
      assigned: 'manager' as const,
      dates: [-1, 2, 5],
      skipped: null,
    },
  ];
  for (const s of series) {
    const seriesId = demoId(`task-series:${s.key}`);
    const clientId = org.clients[s.engagement.clientKey]!;
    await tx.taskSeries.upsert({
      where: { id: seriesId },
      update: {},
      create: {
        id: seriesId,
        businessId,
        clientId,
        engagementId: s.engagement.id,
        serviceId: org.serviceIds(s.service),
        typeId: typeId[s.type],
        title: s.title,
        details: s.details,
        priority: 'HIGH',
        assignmentRule: 'SPECIFIC_USER',
        assignedUserId: user(s.assigned),
        extraAssigneeIds: [user('manager') === user(s.assigned) ? user('admin') : user('manager')],
        interval: s.interval,
        unit: s.unit,
        pattern: { monthly: 'DAY_OF_MONTH' },
        startOn: fifteenth(s.dates[0]!),
        leadDays: 7,
        checklist: STEPS[s.type].map((label, i) => ({ label, required: i === 0 })),
        reminders: [{ daysBefore: 3, inApp: true, channels: ['EMAIL'] }],
        createdByUserId: user('manager'),
      },
    });
    for (const [i, months] of s.dates.entries()) {
      const occurrenceId = demoId(`task-occurrence:${s.key}:${months}`);
      if (await tx.taskOccurrence.findUnique({ where: { id: occurrenceId } })) continue;
      const due = fifteenth(months);
      if (i === 0) {
        // The past due date: its task was made a week ahead.
        const taskId = demoId(`task:series:${s.key}:${months}`);
        await tx.task.upsert({
          where: { id: taskId },
          update: {},
          create: {
            id: taskId,
            businessId,
            clientId,
            engagementId: s.engagement.id,
            title: s.title,
            details: s.details,
            status: 'OPEN',
            progress: 'IN_PROGRESS',
            priority: 'HIGH',
            dueOn: due,
            assignedUserId: user(s.assigned),
            createdByUserId: user('manager'),
            serviceId: org.serviceIds(s.service),
            typeId: typeId[s.type],
          },
        });
        await tx.taskOccurrence.create({
          data: {
            id: occurrenceId,
            businessId,
            seriesId,
            scheduledOn: due,
            dueOn: due,
            state: 'GENERATED',
            taskId,
            generatedAt: new Date(due.getTime() - 7 * 86_400_000),
          },
        });
      } else {
        await tx.taskOccurrence.create({
          data: {
            id: occurrenceId,
            businessId,
            seriesId,
            scheduledOn: due,
            dueOn: due,
            ...(months === s.skipped
              ? {
                  state: 'SKIPPED',
                  skipReason: 'Client closed for the month; no activity to close.',
                }
              : {}),
          },
        });
      }
    }
  }
}

/**
 * Checklists, collaborators and reminders on about half of the open tasks, done checklists on some
 * done tasks, and a client document attached to tasks whose client has one.
 */
async function seedTaskParts(tx: TxClient, businessId: string) {
  const tasks = await tx.task.findMany({
    where: { businessId, archivedAt: null, type: { isNot: null } },
    select: {
      id: true,
      clientId: true,
      status: true,
      assignedUserId: true,
      completedAt: true,
      type: { select: { name: true } },
    },
    orderBy: { id: 'asc' },
  });
  const documents = await tx.document.findMany({
    where: { businessId },
    select: { id: true, clientId: true },
    orderBy: { id: 'asc' },
  });
  const collaborators = [user('manager'), user('clientSupport'), user('admin')];

  for (const [i, task] of tasks.entries()) {
    const name = task.type!.name as TypeName;
    const open = task.status === 'OPEN';
    const done = task.status === 'DONE';
    if ((open && i % 2 === 0) || (done && i % 3 === 0)) {
      for (const [k, label] of STEPS[name].entries()) {
        const id = demoId(`task-checklist:${task.id}:${k}`);
        // Open tasks: the first step done; done tasks: every step done.
        const complete = done || k === 0;
        await tx.taskChecklistItem.upsert({
          where: { id },
          update: {},
          create: {
            id,
            businessId,
            taskId: task.id,
            label,
            position: k,
            required: k === 0,
            ...(complete
              ? {
                  completedAt: task.completedAt ?? demoDay(-2),
                  completedByUserId: task.assignedUserId,
                }
              : {}),
            ...(k === 2 && !complete ? { assignedUserId: user('clientSupport') } : {}),
          },
        });
      }
    }
    if (open && i % 3 === 0) {
      const collaborator = collaborators.find((c) => c !== task.assignedUserId)!;
      await tx.taskAssignee.upsert({
        where: { taskId_userId: { taskId: task.id, userId: collaborator } },
        update: {},
        create: { businessId, taskId: task.id, userId: collaborator },
      });
    }
    if (open && i % 2 === 1) {
      for (const [daysBefore, channels] of [
        [3, ['EMAIL']],
        [0, []],
      ] as const) {
        const id = demoId(`task-reminder:${task.id}:${daysBefore}`);
        await tx.taskReminder.upsert({
          where: { id },
          update: {},
          create: {
            id,
            businessId,
            taskId: task.id,
            daysBefore,
            timeOfDay: new Date('1970-01-01T09:00:00Z'),
            channels: [...channels],
          },
        });
      }
    }
    const document = documents.find((d) => d.clientId === task.clientId);
    if (document && i % 4 === 0) {
      const id = demoId(`task-attachment:${task.id}`);
      await tx.taskAttachment.upsert({
        where: { id },
        update: {},
        create: {
          id,
          businessId,
          taskId: task.id,
          documentId: document.id,
          addedByUserId: task.assignedUserId,
        },
      });
    }
  }
}

/** The firm's tags: two or three per tagged client, and on some leads. */
async function seedTags(tx: TxClient, org: DemoOrgResult) {
  const { businessId } = org;
  const tagIds: string[] = [];
  for (const name of TAGS) {
    const id = demoId(`tag:${name}`);
    await tx.tag.upsert({
      where: { id },
      update: {},
      create: { id, businessId, name, createdByUserId: user('admin') },
    });
    tagIds.push(id);
  }
  for (const [i, c] of SEED_DEMO_CLIENTS.entries()) {
    if (i % 2 === 1) continue;
    for (const tagId of [tagIds[i % TAGS.length]!, tagIds[(i + 2) % TAGS.length]!]) {
      await tx.clientTag.upsert({
        where: { clientId_tagId: { clientId: org.clients[c.key]!, tagId } },
        update: {},
        create: {
          businessId,
          clientId: org.clients[c.key]!,
          tagId,
          addedByUserId: user('manager'),
        },
      });
    }
  }
  // Harper (the portal client) is a referral partner who filed an extension.
  const harper = org.clients['01']!;
  for (const name of ['Referral Partner', 'Extension Filed'] as const) {
    const tagId = demoId(`tag:${name}`);
    await tx.clientTag.upsert({
      where: { clientId_tagId: { clientId: harper, tagId } },
      update: {},
      create: { businessId, clientId: harper, tagId, addedByUserId: user('manager') },
    });
  }
  const leads = await tx.lead.findMany({
    where: { businessId },
    select: { id: true },
    orderBy: { id: 'asc' },
  });
  for (const [i, lead] of leads.entries()) {
    if (i % 3 !== 0) continue;
    const tagId = tagIds[(i / 3) % 2 === 0 ? 2 : 4]!;
    await tx.leadTag.upsert({
      where: { leadId_tagId: { leadId: lead.id, tagId } },
      update: {},
      create: { businessId, leadId: lead.id, tagId, addedByUserId: user('clientSupport') },
    });
  }
}
