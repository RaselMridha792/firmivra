import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import type { TxClient } from '@firmivra/db';
import { z } from 'zod';
import { createHash } from 'node:crypto';
import { requestContext } from '../common/request-context.js';
export function firmContext() {
  const store = requestContext.getStore();
  if (!store?.tenant || !store.auth) throw missing();
  return {
    businessId: store.tenant.businessId,
    userId: store.auth.userId,
    role: store.tenant.role,
    kind: store.tenant.kind,
  };
}
export const missing = () => new NotFoundException({ code: 'NOT_FOUND', message: 'Not found' });
/** Recheck permission after waiting for a transaction lock: the guard's earlier snapshot may be stale. */
export async function activeManager(tx: TxClient, context: ReturnType<typeof firmContext>) {
  const firm = await tx.business.findFirst({
    where: { id: context.businessId, status: 'ACTIVE' },
    select: { id: true },
  });
  if (!firm) throw missing();
  const actor = await tx.membership.findFirst({
    where: { businessId: context.businessId, userId: context.userId, status: 'ACTIVE' },
    select: { role: true },
  });
  if (!actor) throw missing();
  if (actor.role !== 'OWNER' && actor.role !== 'ADMIN')
    throw new ForbiddenException({ code: 'FORBIDDEN', message: 'This action is not permitted' });
  return actor.role;
}
const Cursor = z.strictObject({
  businessId: z.uuid(),
  userId: z.uuid(),
  filters: z.string(),
  id: z.uuid(),
  createdAt: z.iso.datetime({ offset: true }),
});
export function filterKey(filters: Record<string, unknown>) {
  return createHash('sha256')
    .update(
      JSON.stringify(
        Object.fromEntries(
          Object.keys(filters)
            .sort()
            .map((key) => [key, filters[key]]),
        ),
      ),
    )
    .digest('hex');
}
export function encodeCursor(
  context: { businessId: string; userId: string },
  filters: Record<string, unknown>,
  row: { id: string; createdAt: Date | string },
) {
  return Buffer.from(
    JSON.stringify({
      businessId: context.businessId,
      userId: context.userId,
      filters: filterKey(filters),
      id: row.id,
      createdAt: new Date(row.createdAt).toISOString(),
    }),
  ).toString('base64url');
}
export function decodeCursor(
  value: string | undefined,
  context: { businessId: string; userId: string },
  filters: Record<string, unknown>,
) {
  if (!value) return undefined;
  try {
    const row = Cursor.parse(JSON.parse(Buffer.from(value, 'base64url').toString('utf8')));
    if (
      row.businessId !== context.businessId ||
      row.userId !== context.userId ||
      row.filters !== filterKey(filters)
    )
      throw new Error('scope mismatch');
    return { id: row.id, createdAt: new Date(row.createdAt) };
  } catch {
    throw new BadRequestException({ code: 'INVALID_CURSOR', message: 'Invalid page cursor' });
  }
}
export function pageBoundary(cursor: ReturnType<typeof decodeCursor>) {
  return cursor
    ? {
        OR: [
          { createdAt: { lt: cursor.createdAt } },
          { createdAt: cursor.createdAt, id: { lt: cursor.id } },
        ],
      }
    : {};
}
