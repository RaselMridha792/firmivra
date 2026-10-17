// Demo seed, stage 3 (R0, PART 2): the notification bell, for staff and for the portal client.
// Each item points at a real demo record (a lead, a sign-up, an upload, a payment, a message, an
// appointment, an intake, a request, an invoice), uses the event keys the API itself produces,
// and carries only small display values, never record contents. Some are read, most are not.
import { runInScope, type createPrismaClient } from '../src/client.js';
import { demoId, demoSignupUserId, SEED_DEMO_USERS, type DemoStaffKey } from './seed-demo-data.js';
import type { DemoOrgResult } from './seed-demo-org.js';

type Prisma = ReturnType<typeof createPrismaClient>;
type Category =
  'ACCOUNT' | 'DOCUMENTS' | 'INTAKE' | 'SERVICES' | 'MESSAGES' | 'APPOINTMENTS' | 'BILLING';

interface DemoNotice {
  key: string;
  to: DemoStaffKey | 'portalClient';
  category: Category;
  type: string;
  entityType: string;
  entityKey: string;
  payload?: Record<string, string>;
  /** Hours ago. */
  ago: number;
  read?: boolean;
}

const NOTICES: readonly DemoNotice[] = [
  {
    key: 'n01',
    to: 'manager',
    category: 'INTAKE',
    type: 'lead.submitted',
    entityType: 'lead',
    entityKey: 'lead:l01',
    payload: { name: 'Nora Whitfield', service: 'Annual Tax' },
    ago: 3,
  },
  {
    key: 'n02',
    to: 'manager',
    category: 'MESSAGES',
    type: 'message.received',
    entityType: 'message_thread',
    entityKey: 'thread:t03',
    payload: { from: 'Harper Coleman' },
    ago: 2,
  },
  {
    key: 'n03',
    to: 'manager',
    category: 'INTAKE',
    type: 'intake.submitted',
    entityType: 'intake',
    entityKey: 'intake:01:planning',
    payload: { client: 'Harper Coleman' },
    ago: 26,
    read: true,
  },
  {
    key: 'n04',
    to: 'manager',
    category: 'APPOINTMENTS',
    type: 'appointment.booked',
    entityType: 'appointment',
    entityKey: 'appointment:a18',
    payload: { client: 'Harper Coleman' },
    ago: 30,
  },
  {
    key: 'n05',
    to: 'owner',
    category: 'ACCOUNT',
    type: 'client_account.signed_up',
    entityType: 'client_account',
    entityKey: 'signup:su1',
    payload: { name: 'Rachel Kim' },
    ago: 20,
  },
  {
    key: 'n06',
    to: 'owner',
    category: 'BILLING',
    type: 'payment.received',
    entityType: 'invoice',
    entityKey: 'invoice:INV-2009',
    payload: { number: 'INV-2009', amount: '$550.00' },
    ago: 50,
    read: true,
  },
  {
    key: 'n07',
    to: 'owner',
    category: 'INTAKE',
    type: 'lead.submitted',
    entityType: 'lead',
    entityKey: 'lead:l03',
    payload: { name: 'Mia Hernandez', service: 'Tax Planning' },
    ago: 8,
  },
  {
    key: 'n08',
    to: 'clientSupport',
    category: 'ACCOUNT',
    type: 'client_account.signed_up',
    entityType: 'client_account',
    entityKey: 'signup:su2',
    payload: { name: 'Tomas Rivera' },
    ago: 44,
  },
  {
    key: 'n09',
    to: 'taxPreparer',
    category: 'DOCUMENTS',
    type: 'document.uploaded',
    entityType: 'document',
    entityKey: 'document:upload:r08',
    payload: { client: 'Rowan Mitchell' },
    ago: 5,
  },
  {
    key: 'n10',
    to: 'bookkeeper',
    category: 'DOCUMENTS',
    type: 'document.uploaded',
    entityType: 'document',
    entityKey: 'document:upload:r13',
    payload: { client: 'Harborview Dental PLLC' },
    ago: 28,
    read: true,
  },
  {
    key: 'n11',
    to: 'portalClient',
    category: 'DOCUMENTS',
    type: 'document.requested',
    entityType: 'document_request',
    entityKey: 'document-request:r01',
    payload: { title: 'W-2 from your employer' },
    ago: 72,
    read: true,
  },
  {
    key: 'n12',
    to: 'portalClient',
    category: 'BILLING',
    type: 'invoice.sent',
    entityType: 'invoice',
    entityKey: 'invoice:INV-2002',
    payload: { number: 'INV-2002', amount: '$225.00' },
    ago: 120,
  },
  {
    key: 'n13',
    to: 'portalClient',
    category: 'MESSAGES',
    type: 'message.received',
    entityType: 'message_thread',
    entityKey: 'thread:t03',
    payload: { from: 'Demo Accounting Group' },
    ago: 20,
  },
  {
    key: 'n14',
    to: 'portalClient',
    category: 'APPOINTMENTS',
    type: 'appointment.reminder',
    entityType: 'appointment',
    entityKey: 'appointment:a08',
    payload: { when: 'today' },
    ago: 4,
  },
  {
    key: 'n15',
    to: 'portalClient',
    category: 'DOCUMENTS',
    type: 'document.shared',
    entityType: 'document',
    entityKey: 'document:return:01:2024',
    payload: { title: '2024 Form 1040 - Filed' },
    ago: 240,
    read: true,
  },
];

export async function seedDemoNotifications(prisma: Prisma, org: DemoOrgResult): Promise<void> {
  const { businessId } = org;

  await runInScope(prisma, { kind: 'business', businessId }, async (tx) => {
    for (const n of NOTICES) {
      const id = demoId(`notification:${n.key}`);
      if (await tx.notification.findUnique({ where: { id } })) continue;
      // The record's id from its demoId key; a sign-up's is its client account, found by login.
      const entityId = n.entityKey.startsWith('signup:')
        ? (
            await tx.clientAccount.findUniqueOrThrow({
              where: { userId: demoSignupUserId(n.entityKey.slice('signup:'.length)) },
            })
          ).id
        : demoId(n.entityKey);
      const createdAt = new Date(Date.now() - n.ago * 3_600_000);
      await tx.notification.create({
        data: {
          id,
          businessId,
          recipientUserId:
            n.to === 'portalClient' ? demoId('user:client:01') : SEED_DEMO_USERS[n.to].id,
          category: n.category,
          type: n.type,
          entityType: n.entityType,
          entityId,
          payload: n.payload ?? {},
          eventKey: `demo:${n.key}`,
          createdAt,
        },
      });
      if (n.read) {
        await tx.notification.update({
          where: { id },
          data: { readAt: new Date(createdAt.getTime() + 30 * 60_000) },
        });
      }
    }
  });
}
