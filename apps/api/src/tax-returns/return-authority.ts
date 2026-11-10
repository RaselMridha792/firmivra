import { ForbiddenException } from '@nestjs/common';
import type { TxClient } from '@firmivra/db';
import type { PermissionGrantsService } from '../roles/permission-grants.service.js';

// TX-F18 (Octavia's Oct 26 review; Rasel's go on the role check), for the tasks and schedule items
// tied to a tax return: an item of the return's engagement is reassigned only by the return's
// preparer or reviewer, or by an Owner, or an Admin whose grid keeps APPROVE on Tax Returns (the
// override, which the caller records). Anything not tied to a return is as before.

export type ReassignAuthority = 'free' | 'responsible' | 'override';

/**
 * Whether `actor` may reassign an item of `engagementId`; throws 403 when not. 'free': the item is
 * not tied to a live tax return.
 */
export async function returnReassignAuthority(
  tx: TxClient,
  grants: PermissionGrantsService,
  businessId: string,
  actor: { userId: string; role: 'OWNER' | 'ADMIN' | 'STAFF' },
  engagementId: string | null,
): Promise<ReassignAuthority> {
  if (!engagementId) return 'free';
  const returns = await tx.taxReturn.findMany({
    where: { businessId, engagementId, archivedAt: null },
    select: { preparerUserId: true, reviewerUserId: true },
  });
  if (returns.length === 0) return 'free';
  if (returns.some((r) => r.preparerUserId === actor.userId || r.reviewerUserId === actor.userId))
    return 'responsible';
  if (actor.role === 'OWNER') return 'override';
  if (actor.role === 'ADMIN') {
    const own = await grants.memberCell(businessId, actor.userId, 'TAX_RETURNS', 'APPROVE');
    if (own ?? (await grants.can(businessId, 'ADMIN', 'TAX_RETURNS', 'APPROVE'))) return 'override';
  }
  throw new ForbiddenException({
    code: 'FORBIDDEN',
    message:
      'This belongs to a tax return: only its preparer or reviewer, or an Owner or Admin, can reassign it',
  });
}
