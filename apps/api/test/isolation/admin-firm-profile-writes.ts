// R56: applying a firm's Request Change (admin-firm-profile) for admin-scope.test.ts, against a
// Request Change ticket of the fixture firm A (Active) made with the owner client, asking for its
// legal name. The write runs R1's definer function from admin scope and opens no firm scope.
import { randomUUID } from 'node:crypto';
import { createPrismaClient, runInScope } from '@firmivra/db';
import { TEST_CLIENT_OPTIONS, testDatabaseUrls } from '@firmivra/db/testing';
import type { Fixtures } from '../global-setup.js';
import type { SupportWrite } from './admin-support-writes.js';

const tag = randomUUID().slice(0, 8);
const refs = { ticketId: '' };

type FirmProfileWrite = SupportWrite & { paramsFn?: () => Record<string, string> };

export function firmProfileWrites(fx: Fixtures): Record<string, FirmProfileWrite> {
  return {
    'POST /api/v1/admin/firms/:id/profile-changes/:ticketId/apply': {
      body: { legalName: `Fake Scope Legal Name ${tag}` },
      paramsFn: () => ({ id: fx.firmA.id, ticketId: refs.ticketId }),
    },
  };
}

export async function prepareFirmProfile(fx: Fixtures): Promise<void> {
  const owner = createPrismaClient(testDatabaseUrls('test_api').owner, TEST_CLIENT_OPTIONS);
  try {
    await runInScope(owner, { kind: 'platform' }, async (tx) => {
      const category = await tx.supportCategory.findFirstOrThrow({ select: { id: true } });
      const priority = await tx.supportPriority.findFirstOrThrow({ select: { id: true } });
      const ticket = await tx.supportTicket.create({
        data: {
          businessId: fx.firmA.id,
          contactUserId: fx.users.ownerA.id,
          subject: 'Company Information change request: Legal Company Name',
          description: [
            'Legal Company Name',
            'Current: Not on file',
            `Proposed: Fake Scope Legal Name ${tag}`,
          ].join('\n'),
          categoryId: category.id,
          priorityId: priority.id,
          source: 'PORTAL',
          createdByUserId: fx.users.ownerA.id,
        },
      });
      refs.ticketId = ticket.id;
    });
  } finally {
    await owner.$disconnect();
  }
}
