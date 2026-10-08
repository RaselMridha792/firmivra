import { ConflictException, GoneException, NotFoundException } from '@nestjs/common';
import type { DocumentRequestStatus, Prisma, TxClient } from '@firmivra/db';
import { DOCUMENT_ERRORS, type DocumentErrorCode, type FirmDocument } from '@firmivra/types';

// Rules and shapes shared by the firm and portal sides of the documents module (R5).

/** A 409 (410 for UPLOAD_EXPIRED) with the words users see (DOCUMENT_ERRORS). */
export const refusal = (code: DocumentErrorCode, message: string = DOCUMENT_ERRORS[code]) =>
  code === 'UPLOAD_EXPIRED'
    ? new GoneException({ code, message })
    : new ConflictException({ code, message });
export const notFound = () => new NotFoundException({ code: 'NOT_FOUND', message: 'Not found' });

/** Requests the client can still answer: an upload for one makes it SUBMITTED. */
export const OPEN_REQUEST: DocumentRequestStatus[] = ['REQUESTED', 'REJECTED'];

/** Who acts on the firm side: the signed-in member and their role here (from TenantGuard). */
export interface FirmActor {
  userId: string;
  role: 'OWNER' | 'ADMIN' | 'STAFF';
}

/** Staff reach only the clients assigned to them; Owner and Admin every client. Others are 404. */
export const clientReach = (actor: FirmActor): Prisma.ClientWhereInput =>
  actor.role === 'STAFF' ? { assignedUserId: actor.userId } : {};

/** The client, if this member may reach it; else 404. */
export async function reachableClient(
  tx: TxClient,
  businessId: string,
  actor: FirmActor,
  clientId: string,
): Promise<void> {
  const row = await tx.client.findFirst({
    where: { businessId, id: clientId, ...clientReach(actor) },
    select: { id: true },
  });
  if (!row) throw notFound();
}

export interface Target {
  engagement: { id: string; taxYear: number | null };
  request: { id: string; categoryId: string | null } | null;
  category: { id: string; retentionYears: number | null } | null;
}

/**
 * The service (engagement), request and category an upload names, all of this client and firm:
 * every 404 before any 409. Then NO_OPEN_SERVICE (the engagement is not ACTIVE), REQUEST_CLOSED
 * (the request is of another service, or not REQUESTED or REJECTED) and CATEGORY_ARCHIVED.
 */
export async function findTarget(
  tx: TxClient,
  businessId: string,
  clientId: string,
  ids: { serviceId: string; requestId?: string | null; categoryId?: string | null },
): Promise<Target> {
  const engagement = await tx.engagement.findFirst({
    where: { businessId, clientId, id: ids.serviceId },
    select: { id: true, status: true, taxYear: true },
  });
  const request = ids.requestId
    ? await tx.documentRequest.findFirst({
        where: { businessId, clientId, id: ids.requestId },
        select: { id: true, engagementId: true, status: true, categoryId: true },
      })
    : null;
  const category = ids.categoryId
    ? await tx.documentCategory.findFirst({
        where: { businessId, id: ids.categoryId },
        select: { id: true, retentionYears: true, archivedAt: true },
      })
    : null;
  if (!engagement || (ids.requestId && !request) || (ids.categoryId && !category)) {
    throw notFound();
  }
  if (engagement.status !== 'ACTIVE') throw refusal('NO_OPEN_SERVICE');
  if (
    request &&
    (request.engagementId !== engagement.id || !OPEN_REQUEST.includes(request.status))
  ) {
    throw refusal('REQUEST_CLOSED');
  }
  if (category?.archivedAt) throw refusal('CATEGORY_ARCHIVED');
  return {
    engagement: { id: engagement.id, taxYear: engagement.taxYear },
    request: request && { id: request.id, categoryId: request.categoryId },
    category: category && { id: category.id, retentionYears: category.retentionYears },
  };
}

export const documentSelect = {
  id: true,
  clientId: true,
  requestId: true,
  direction: true,
  fileName: true,
  contentType: true,
  sizeBytes: true,
  sha256: true,
  s3Key: true,
  scanStatus: true,
  taxYear: true,
  uploadedByUserId: true,
  createdAt: true,
  engagement: { select: { id: true, title: true } },
  category: { select: { id: true, name: true } },
} satisfies Prisma.DocumentSelect;
export type DocumentRow = Prisma.DocumentGetPayload<{ select: typeof documentSelect }>;

/** Names of the people behind `userIds` that this firm knows (its members and client logins). */
export type People = Map<string, { name: string; byClient: boolean }>;

export async function peopleOf(tx: TxClient, userIds: (string | null)[]): Promise<People> {
  const ids = [...new Set(userIds.filter((id): id is string => id !== null))];
  if (ids.length === 0) return new Map();
  // Business scope: row-level security shows only users linked to this firm.
  const users = await tx.user.findMany({
    where: { id: { in: ids } },
    select: { id: true, name: true, pool: true },
  });
  return new Map(users.map((u) => [u.id, { name: u.name, byClient: u.pool === 'CLIENT' }]));
}

const service = (row: DocumentRow) => ({ id: row.engagement.id, title: row.engagement.title });

export function toFirmDocument(row: DocumentRow, people: People): FirmDocument {
  const by = row.uploadedByUserId ? people.get(row.uploadedByUserId) : undefined;
  return {
    id: row.id,
    clientId: row.clientId,
    service: service(row),
    category: row.category,
    requestId: row.requestId,
    direction: row.direction,
    fileName: row.fileName,
    contentType: row.contentType,
    sizeBytes: row.sizeBytes,
    taxYear: row.taxYear,
    scanStatus: row.scanStatus,
    uploadedBy: by ? { name: by.name, byClient: by.byClient } : null,
    createdAt: row.createdAt.toISOString(),
  };
}

/** Locks the request until the transaction ends (Prisma has no FOR UPDATE). */
export async function lockRequest(tx: TxClient, businessId: string, id: string): Promise<void> {
  await tx.$queryRaw`SELECT 1 FROM document_requests
    WHERE business_id = ${businessId}::uuid AND id = ${id}::uuid FOR UPDATE`;
}

/** Keeps the engagement's status as it is until the transaction ends. */
export async function holdEngagement(tx: TxClient, businessId: string, id: string): Promise<void> {
  await tx.$queryRaw`SELECT 1 FROM engagements
    WHERE business_id = ${businessId}::uuid AND id = ${id}::uuid FOR SHARE`;
}
