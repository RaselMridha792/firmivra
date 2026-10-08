// AuditService: where a row goes. Left out, the firm and the actor come from the request, as they
// always have; `businessId: null` is the platform's row even in a firm's request (R8: the
// platform's copy of a firm Owner's answer to a support access request).
import { describe, expect, it, vi } from 'vitest';
import type { Database, TxClient } from '@firmivra/db';
import { AuditService } from '../../src/audit/audit.service.js';
import { requestContext, type RequestStore } from '../../src/common/request-context.js';

const firm = '0199b6e0-0000-7000-8000-000000000001';
const other = '0199b6e0-0000-7000-8000-000000000002';
const owner = '0199b6e0-0000-7000-8000-000000000101';

/** A database that records which scope each row was written in. */
function fakeDb() {
  const writes: { scope: string; data: Record<string, unknown> }[] = [];
  const client = (scope: string) => ({
    auditLog: {
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        writes.push({ scope, data });
      }),
    },
  });
  const db = {
    forBusiness: (businessId: string) => client(`business:${businessId}`),
    forPlatform: () => client('platform'),
  } as unknown as Database;
  return { db, writes };
}

const inFirm: RequestStore = {
  requestId: 'req-1',
  ip: '203.0.113.5',
  userAgent: 'Fake/1.0',
  auth: { userId: owner, cognitoSub: 'sub-1', pool: 'STAFF' },
  tenant: { businessId: firm, role: 'OWNER', kind: 'staff' },
};
const where = (writes: { scope: string; data: Record<string, unknown> }[]) =>
  writes.map((w) => [w.scope, w.data.businessId, w.data.actorUserId]);

describe('AuditService: where a row goes', () => {
  it('left out or undefined, the firm and the actor come from the request, as before', async () => {
    const { db, writes } = fakeDb();
    const audit = new AuditService(db);
    await requestContext.run(inFirm, async () => {
      await audit.log('thing.done', { type: 'thing', id: 't1' }, { n: 1 });
      await audit.log('thing.done', { type: 'thing' }, undefined, { businessId: undefined });
      await audit.log('thing.done', { type: 'thing' }, undefined, { businessId: other });
    });
    expect(where(writes)).toEqual([
      [`business:${firm}`, firm, owner],
      [`business:${firm}`, firm, owner],
      [`business:${other}`, other, owner],
    ]);
    expect(writes[0]?.data).toMatchObject({
      action: 'thing.done',
      entityType: 'thing',
      entityId: 't1',
      metadata: { n: 1 },
      ip: '203.0.113.5',
      userAgent: 'Fake/1.0',
      requestId: 'req-1',
    });
  });

  it("businessId null is the platform's row in a firm's request, with the request's actor", async () => {
    const { db, writes } = fakeDb();
    const audit = new AuditService(db);
    const tx = { auditLog: { create: vi.fn() } };
    await requestContext.run(inFirm, async () => {
      await audit.log(
        'support.approved',
        { type: 'support_access_grant', id: 'g1' },
        { businessId: firm, hours: 2 },
        { businessId: null },
      );
      await audit.logIn(tx as unknown as TxClient, 'thing.done', { type: 'thing' }, undefined, {
        businessId: null,
      });
    });
    expect(where(writes)).toEqual([['platform', null, owner]]);
    expect(tx.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ businessId: null, actorUserId: owner }) as unknown,
    });
  });

  it("without a request or a firm, the row is the platform's, as before", async () => {
    const { db, writes } = fakeDb();
    await new AuditService(db).log('thing.done', { type: 'thing' });
    expect(where(writes)).toEqual([['platform', null, null]]);
  });
});
