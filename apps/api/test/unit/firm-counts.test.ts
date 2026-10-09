// The firms page's counts come from one statement, so the total always equals the sum of the
// parts, even while other requests add firms.
import { describe, expect, it, vi } from 'vitest';
import type { AdminPrisma } from '../../src/firm-applications/admin-prisma.js';
import { FirmApplicationsService } from '../../src/firm-applications/firm-applications.service.js';

describe('firmCounts', () => {
  it('reads one groupBy on status and sums it', async () => {
    const groupBy = vi.fn().mockResolvedValue([
      { status: 'ACTIVE', _count: { _all: 5 } },
      { status: 'PENDING_SETUP', _count: { _all: 2 } },
      { status: 'SUSPENDED', _count: { _all: 1 } },
      { status: 'CLOSED', _count: { _all: 3 } },
    ]);
    const count = vi.fn();
    const db = { business: { groupBy, count } };
    const service = new FirmApplicationsService(
      { db } as unknown as AdminPrisma,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    );
    expect(await service.firmCounts()).toEqual({
      active: 5,
      pendingSetup: 2,
      inactive: 4,
      total: 11,
    });
    expect(groupBy).toHaveBeenCalledTimes(1);
    expect(count).not.toHaveBeenCalled();
  });

  it('answers zeros with no firms', async () => {
    const db = { business: { groupBy: vi.fn().mockResolvedValue([]) } };
    const service = new FirmApplicationsService(
      { db } as unknown as AdminPrisma,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    );
    expect(await service.firmCounts()).toEqual({
      active: 0,
      pendingSetup: 0,
      inactive: 0,
      total: 0,
    });
  });
});
