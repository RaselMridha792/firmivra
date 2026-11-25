import { createHash, randomUUID } from 'node:crypto';
import { createPrismaClient, runInScope } from '@firmivra/db';
import { TEST_CLIENT_OPTIONS, testDatabaseUrls } from '@firmivra/db/testing';
import type { Fixtures } from '../global-setup.js';
import type { SupportWrite } from './admin-support-writes.js';

const id = randomUUID();
const refs = { businessId: '', grantId: '' };

export function firmDownloadWrites(): Record<
  string,
  SupportWrite & { paramsFn?: () => Record<string, string> }
> {
  return {
    'POST /api/v1/admin/firms/:businessId/download-access': {
      body: { reason: 'Fake retention access request' },
      paramsFn: () => ({ businessId: refs.businessId }),
    },
    'POST /api/v1/admin/firms/:businessId/download-access/:grantId/revoke': {
      body: { reason: 'Fake access revoke' },
      paramsFn: () => ({ businessId: refs.businessId, grantId: refs.grantId }),
    },
  };
}

export async function prepareFirmDownload(fx: Fixtures): Promise<void> {
  const owner = createPrismaClient(testDatabaseUrls('test_api').owner, TEST_CLIENT_OPTIONS);
  try {
    const userId = randomUUID();
    const businessId = randomUUID();
    await runInScope(owner, { kind: 'platform' }, async (tx) => {
      await tx.user.create({
        data: {
          id: userId,
          cognitoSub: userId,
          pool: 'STAFF',
          email: `fake-q32-owner-${id.slice(0, 8)}@example.test`,
          name: 'Fake Q32 Owner',
        },
      });
      await tx.business.create({
        data: {
          id: businessId,
          name: `Fake Q32 Firm ${id.slice(0, 8)}`,
          slug: `fake-q32-${id.slice(0, 8)}`,
          status: 'ACTIVE',
        },
      });
      await tx.business.update({ where: { id: businessId }, data: { status: 'CLOSED' } });
    });
    await runInScope(owner, { kind: 'business', businessId }, async (tx) => {
      await tx.membership.create({ data: { businessId, userId, role: 'OWNER', status: 'ACTIVE' } });
    });
    await runInScope(owner, { kind: 'platform' }, async (tx) => {
      const closed = await tx.business.findUniqueOrThrow({
        where: { id: businessId },
        select: { closedAt: true },
      });
      const grant = await tx.firmDataDownloadGrant.create({
        data: {
          businessId,
          ownerUserId: userId,
          kind: 'REQUESTED',
          reason: 'Fake seed grant',
          grantedByUserId: fx.users.admin.id,
          tokenHash: createHash('sha256').update(randomUUID()).digest('hex'),
          startsAt: new Date(),
          expiresAt: new Date(closed.closedAt!.getTime() + 30 * 86_400_000),
        },
        select: { id: true },
      });
      refs.grantId = grant.id;
    });
    refs.businessId = businessId;
  } finally {
    await owner.$disconnect();
  }
}
