// Demo seed, stage 2 (R0, PART 2): message threads for the firm's inbox, a client's Messages tab
// and the portal. The portal client (01) has a real back-and-forth (with an attachment); every
// other client only has firm-started threads, since only the portal client has a login to send
// from. Some messages are read, some unread; one thread is archived.
import { runInScope, type createPrismaClient } from '../src/client.js';
import { demoId, SEED_DEMO_USERS, type DemoStaffKey } from './seed-demo-data.js';
import { demoDay, demoEngagementId, type DemoEngagementSlot } from './seed-demo-engagements.js';
import type { DemoOrgResult } from './seed-demo-org.js';

type Prisma = ReturnType<typeof createPrismaClient>;

interface DemoMessage {
  from: 'client' | DemoStaffKey;
  body: string;
  /** Days from today, and the hour (UTC). */
  day: number;
  hour: number;
  read?: boolean;
  /** A demo document key (seed-demo-documents) to attach. */
  attach?: string;
}

interface DemoThread {
  key: string;
  clientKey: string;
  slot?: DemoEngagementSlot;
  subject: string;
  assigned: DemoStaffKey;
  archived?: boolean;
  messages: readonly DemoMessage[];
}

const THREADS: readonly DemoThread[] = [
  {
    key: 't01',
    clientKey: '01',
    subject: 'Welcome to Demo Accounting Group',
    assigned: 'clientSupport',
    messages: [
      {
        from: 'clientSupport',
        body: 'Welcome to your client portal! You can message us here any time, upload documents and pay invoices.',
        day: -60,
        hour: 14,
        read: true,
      },
    ],
  },
  {
    key: 't02',
    clientKey: '01',
    slot: 'tax2025',
    subject: 'Question about my 1099-INT',
    assigned: 'manager',
    messages: [
      {
        from: 'client',
        body: 'I uploaded my 1099-INT. Do you also need the statement from my savings account?',
        day: -6,
        hour: 15,
        read: true,
        attach: 'upload:r02',
      },
      {
        from: 'manager',
        body: 'Thanks, Harper. The 1099-INT covers it, no need for the statement. We still need your W-2 when it arrives.',
        day: -6,
        hour: 18,
        read: true,
      },
      {
        from: 'client',
        body: 'Great, I will upload the W-2 as soon as I get it.',
        day: -5,
        hour: 13,
      },
    ],
  },
  {
    key: 't03',
    clientKey: '01',
    slot: 'planning',
    subject: 'Your 2026 planning meeting',
    assigned: 'manager',
    messages: [
      {
        from: 'manager',
        body: 'Looking forward to our planning call today. I will walk you through the income projection.',
        day: -1,
        hour: 16,
        read: true,
      },
      {
        from: 'client',
        body: 'Sounds good. Can we also talk about increasing my 401(k) contributions?',
        day: 0,
        hour: 12,
      },
    ],
  },
  {
    key: 't04',
    clientKey: '02',
    slot: 'tax2025',
    subject: 'Reminder: W-2 still needed',
    assigned: 'clientSupport',
    messages: [
      {
        from: 'clientSupport',
        body: 'Hi Sawyer, a friendly reminder that we still need your W-2 to start your return.',
        day: -3,
        hour: 15,
      },
    ],
  },
  {
    key: 't05',
    clientKey: '04',
    slot: 'books',
    subject: 'September financials are ready',
    assigned: 'bookkeeper',
    messages: [
      {
        from: 'bookkeeper',
        body: 'Your September profit and loss and balance sheet are ready in the portal. Revenue was up 8% on August.',
        day: -10,
        hour: 17,
      },
    ],
  },
  {
    key: 't06',
    clientKey: '10',
    slot: 'payroll',
    subject: 'Q3 payroll register received',
    assigned: 'bookkeeper',
    messages: [
      {
        from: 'bookkeeper',
        body: 'We received the Q3 payroll register and will file your 941 this week.',
        day: -2,
        hour: 14,
      },
    ],
  },
  {
    key: 't07',
    clientKey: '13',
    slot: 'books',
    subject: 'Invoice INV-2011 is past due',
    assigned: 'owner',
    messages: [
      {
        from: 'owner',
        body: 'A quick note that invoice INV-2011 for August bookkeeping is past due. You can pay it from the Invoices tab.',
        day: -4,
        hour: 16,
      },
    ],
  },
  {
    key: 't08',
    clientKey: '03',
    slot: 'tax2024',
    subject: 'Your 2024 return was accepted',
    assigned: 'taxPreparer',
    archived: true,
    messages: [
      {
        from: 'taxPreparer',
        body: 'Good news: the IRS accepted your 2024 return. A copy is in your Documents tab.',
        day: -185,
        hour: 15,
      },
    ],
  },
  {
    key: 't09',
    clientKey: '08',
    slot: 'tax2025',
    subject: 'Mortgage statement: missing pages',
    assigned: 'taxPreparer',
    messages: [
      {
        from: 'taxPreparer',
        body: 'Only page 1 of the 1098 came through. Could you upload the remaining pages?',
        day: -1,
        hour: 19,
      },
    ],
  },
  {
    key: 't10',
    clientKey: '25',
    slot: 'books',
    subject: 'Welcome aboard',
    assigned: 'clientSupport',
    messages: [
      {
        from: 'clientSupport',
        body: 'Welcome to Demo Accounting Group! Your bookkeeper is Avery. We will reach out to connect your bank feeds.',
        day: -30,
        hour: 14,
      },
    ],
  },
];

export async function seedDemoMessages(prisma: Prisma, org: DemoOrgResult): Promise<void> {
  const { businessId } = org;

  await runInScope(prisma, { kind: 'business', businessId }, async (tx) => {
    for (const t of THREADS) {
      const threadId = demoId(`thread:${t.key}`);
      await tx.messageThread.upsert({
        where: { id: threadId },
        update: {},
        create: {
          id: threadId,
          businessId,
          clientId: org.clients[t.clientKey]!,
          engagementId: t.slot ? demoEngagementId(t.clientKey, t.slot) : null,
          subject: t.subject,
          assignedUserId: SEED_DEMO_USERS[t.assigned].id,
          createdByUserId:
            t.messages[0]!.from === 'client'
              ? demoId(`user:client:${t.clientKey}`)
              : SEED_DEMO_USERS[t.messages[0]!.from].id,
        },
      });

      for (const [i, m] of t.messages.entries()) {
        const id = demoId(`message:${t.key}:${i}`);
        if (await tx.message.findUnique({ where: { id } })) continue;
        const sentAt = demoDay(m.day);
        sentAt.setUTCHours(m.hour);
        const fromClient = m.from === 'client';
        await tx.message.create({
          data: {
            id,
            businessId,
            threadId,
            direction: fromClient ? 'CLIENT_TO_FIRM' : 'FIRM_TO_CLIENT',
            senderUserId: fromClient
              ? demoId(`user:client:${t.clientKey}`)
              : SEED_DEMO_USERS[m.from as DemoStaffKey].id,
            body: m.body,
            createdAt: sentAt,
          },
        });
        // A new message always starts unread; the recipient reads it later.
        if (m.read) {
          await tx.message.updateMany({
            where: { id, readAt: null },
            data: { readAt: new Date(sentAt.getTime() + 60 * 60 * 1000) },
          });
        }
        if (m.attach) {
          await tx.messageAttachment.create({
            data: { businessId, messageId: id, documentId: demoId(`document:${m.attach}`) },
          });
        }
      }

      if (t.archived) {
        await tx.messageThread.updateMany({
          where: { id: threadId, archivedAt: null },
          data: { archivedAt: demoDay(-180) },
        });
      }
    }
  });
}
