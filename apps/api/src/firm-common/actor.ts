import { ForbiddenException } from '@nestjs/common';
import type { TxClient } from '@firmivra/db';
import { firmContext, missing } from './context.js';
export type FirmActor = ReturnType<typeof firmContext>;
export async function currentActor(tx: TxClient, ctx: FirmActor) {
  if (ctx.kind === 'client') {
    const account = await tx.clientAccount.findFirst({
      where: { businessId: ctx.businessId, userId: ctx.userId, status: 'ACTIVE' },
      select: { clientId: true, accountType: true },
    });
    if (!account?.clientId) throw missing();
    return {
      role: 'CLIENT' as const,
      clientId: account.clientId,
      accountType: account.accountType,
    };
  }
  const member = await tx.membership.findFirst({
    where: { businessId: ctx.businessId, userId: ctx.userId, status: 'ACTIVE' },
    select: { id: true, role: true },
  });
  if (!member) throw missing();
  return { role: member.role, membershipId: member.id, clientId: null, accountType: null };
}
export const denied = () =>
  new ForbiddenException({ code: 'FORBIDDEN', message: 'This action is not permitted' });
