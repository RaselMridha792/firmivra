// SA-FRM-F03, F04, Y10: a firm's account actions for admin-scope.test.ts, run in this order on one
// fake firm of their own (Pending Setup): Suspend, Reactivate (back to Pending Setup), Close. Each
// changes only the firm's status in admin scope and opens no firm scope.
import { randomUUID } from 'node:crypto';
import { createPrismaClient, runInScope } from '@firmivra/db';
import { TEST_CLIENT_OPTIONS, testDatabaseUrls } from '@firmivra/db/testing';
import type { SupportWrite } from './admin-support-writes.js';

const tag = randomUUID().slice(0, 8);
const refs = { firmId: '' };

type FirmAccountWrite = SupportWrite & { paramsFn?: () => Record<string, string> };

export function firmAccountWrites(): Record<string, FirmAccountWrite> {
  const params = () => ({ id: refs.firmId });
  return {
    'POST /api/v1/admin/firms/:id/suspend': {
      body: { reason: 'Fake scope suspension' },
      paramsFn: params,
    },
    'POST /api/v1/admin/firms/:id/reactivate': {
      body: { reason: 'Fake scope reactivation' },
      paramsFn: params,
    },
    'POST /api/v1/admin/firms/:id/close': {
      body: { reason: 'Fake scope closure' },
      paramsFn: params,
    },
  };
}

export async function prepareFirmAccount(): Promise<void> {
  const owner = createPrismaClient(testDatabaseUrls('test_api').owner, TEST_CLIENT_OPTIONS);
  try {
    await runInScope(owner, { kind: 'platform' }, async (tx) => {
      const firm = await tx.business.create({
        data: {
          slug: `fake-scope-account-${tag}`,
          name: `Fake Scope Account Firm ${tag}`,
          status: 'PENDING_SETUP',
        },
      });
      refs.firmId = firm.id;
    });
  } finally {
    await owner.$disconnect();
  }
}
