import type { AdvisoryServiceStatus, TxClient } from '@firmivra/db';
import { ADVISORY_ENGAGED_STATUSES } from '@firmivra/types';

/** A service under way (A-12, A-13): its files and requests need an ACTIVE engagement. */
export const isEngaged = (status: AdvisoryServiceStatus): boolean =>
  ADVISORY_ENGAGED_STATUSES.includes(status);

export interface AdvisoryEngagement {
  id: string;
  status: 'ACTIVE' | 'PENDING';
  /** Started now: the client had no ACTIVE or PENDING engagement on the service. */
  created: boolean;
}

/**
 * The client's open engagement on an advisory service: its ACTIVE one, else its PENDING one (from
 * Begin Online, waiting for staff review, never doubled), else a new ACTIVE one named after the
 * service. Callers hold the advisory client's row lock, so two calls never start two.
 */
export async function ensureAdvisoryEngagement(
  tx: TxClient,
  businessId: string,
  input: { clientId: string; serviceId: string; assignedUserId: string | null },
): Promise<AdvisoryEngagement> {
  const open = await tx.engagement.findMany({
    where: {
      businessId,
      clientId: input.clientId,
      serviceId: input.serviceId,
      status: { in: ['ACTIVE', 'PENDING'] },
    },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    select: { id: true, status: true },
  });
  const found = open.find((e) => e.status === 'ACTIVE') ?? open[0];
  if (found) return { id: found.id, status: found.status as 'ACTIVE' | 'PENDING', created: false };
  const service = await tx.service.findFirstOrThrow({
    where: { businessId, id: input.serviceId },
    select: { name: true },
  });
  const made = await tx.engagement.create({
    data: {
      businessId,
      clientId: input.clientId,
      serviceId: input.serviceId,
      title: service.name,
      status: 'ACTIVE',
      assignedUserId: input.assignedUserId,
    },
    select: { id: true },
  });
  return { id: made.id, status: 'ACTIVE', created: true };
}
