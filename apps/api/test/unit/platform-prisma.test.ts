// Unit test: Super Admin routes reach platform tables only in the database's admin scope, as the
// Super Admin themselves (R0's #52), and nowhere else.
import { describe, expect, it, vi } from 'vitest';
import type { Database } from '@firmivra/db';
import { requestContext } from '../../src/common/request-context.js';
import { PlatformPrisma } from '../../src/database/database.module.js';

const adminId = '0199b6a0-0000-7000-8000-0000000000a1';

function fakeDatabase() {
  return {
    forAdmin: vi.fn(() => ({ scope: 'admin' })),
    forPlatform: vi.fn(() => ({ scope: 'platform' })),
  };
}

describe('PlatformPrisma', () => {
  it("uses the admin scope as the signed-in Super Admin, never the platform's", () => {
    const database = fakeDatabase();
    const prisma = new PlatformPrisma(database as unknown as Database);
    const db = requestContext.run(
      {
        requestId: 'r1',
        auth: { userId: adminId, cognitoSub: 'sub', pool: 'ADMIN' },
        platform: { role: 'SUPER_ADMIN' },
      } as never,
      () => prisma.db,
    );
    expect(db).toEqual({ scope: 'admin' });
    expect(database.forAdmin).toHaveBeenCalledWith(adminId);
    expect(database.forPlatform).not.toHaveBeenCalled();
  });

  it('refuses a request without a verified Super Admin', () => {
    const prisma = new PlatformPrisma(fakeDatabase() as unknown as Database);
    expect(() => prisma.db).toThrow(/outside a Super Admin request/);
    expect(() =>
      requestContext.run(
        { requestId: 'r2', auth: { userId: adminId, cognitoSub: 'sub', pool: 'STAFF' } } as never,
        () => prisma.db,
      ),
    ).toThrow(/outside a Super Admin request/);
  });
});
