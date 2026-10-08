import {
  ConflictException,
  GoneException,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import type { Prisma, TxClient } from '@firmivra/db';
import { DOCUMENT_ERRORS, type DocumentErrorCode, type FirmDocument } from '@firmivra/types';

// Rules and shapes shared by the firm and portal sides of the documents module (R5).

/** A 409 (410 for UPLOAD_EXPIRED) with the words users see (DOCUMENT_ERRORS). */
export const refusal = (code: DocumentErrorCode, message: string = DOCUMENT_ERRORS[code]) =>
  code === 'UPLOAD_EXPIRED'
    ? new GoneException({ code, message })
    : new ConflictException({ code, message });
export const notFound = () => new NotFoundException({ code: 'NOT_FOUND', message: 'Not found' });
/**
 * 503 with Retry-After (the global filter sends `retryAfter`): storage failed, timed out or is
 * busy. Never a deletion: the upload can be confirmed again.
 */
export const storageUnavailable = () =>
  new ServiceUnavailableException({
    code: 'SERVICE_UNAVAILABLE',
    message: 'Files are not available right now. Please try again in a moment.',
    retryAfter: 5,
  });

/** Who acts on the firm side: the signed-in member and their role here (from TenantGuard). */
export interface FirmActor {
  userId: string;
  role: 'OWNER' | 'ADMIN' | 'STAFF';
}

/** Staff reach only the clients assigned to them; Owner and Admin every client. Others are 404. */
export const clientReach = (actor: FirmActor): Prisma.ClientWhereInput =>
  actor.role === 'STAFF' ? { assignedUserId: actor.userId } : {};

/** The client, if this member may reach it; else 404. For reads (uploads lock it instead). */
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

/**
 * The client of an upload, locked FOR SHARE until the upload commits (the #108 review: tasks,
 * reports and appointments lock the client first), so a reassignment or an archive at the same
 * time waits for the upload, or has committed and is seen here. 404 when this member doesn't
 * reach it (Staff: not assigned to them). Lock order: the client, then the engagement.
 */
export async function lockReachableClient(
  tx: TxClient,
  businessId: string,
  actor: FirmActor,
  clientId: string,
): Promise<{ archived: boolean }> {
  const [client] = await tx.$queryRaw<
    { archived_at: Date | null; assigned_user_id: string | null }[]
  >`
    SELECT archived_at, assigned_user_id::text AS assigned_user_id FROM clients
    WHERE business_id = ${businessId}::uuid AND id = ${clientId}::uuid
    FOR SHARE`;
  const reached =
    client && (actor.role !== 'STAFF' || client.assigned_user_id === actor.userId.toLowerCase());
  if (!reached) throw notFound();
  return { archived: client.archived_at !== null };
}

export interface Target {
  engagement: { id: string; taxYear: number | null };
  category: { id: string; retentionYears: number | null } | null;
}

/**
 * The service (engagement) and category an upload names, both of this client and firm: every
 * 404 before any 409. Then NO_OPEN_SERVICE (the engagement is not ACTIVE, or the client is
 * archived) and CATEGORY_ARCHIVED. The category is read FOR SHARE, so an archive at the same time
 * waits for the upload or is seen here (lock order: the client, the engagement, the category).
 * Uploads for a request (REQUEST_CLOSED) come with the portal routes in part 2.
 */
export async function findTarget(
  tx: TxClient,
  businessId: string,
  clientId: string,
  ids: { serviceId: string; categoryId?: string | null; clientArchived: boolean },
): Promise<Target> {
  const engagement = await tx.engagement.findFirst({
    where: { businessId, clientId, id: ids.serviceId },
    select: { id: true, status: true, taxYear: true },
  });
  const [category] = ids.categoryId
    ? await tx.$queryRaw<
        { id: string; retention_years: number | null; archived_at: Date | null }[]
      >`
        SELECT id::text AS id, retention_years, archived_at FROM document_categories
        WHERE business_id = ${businessId}::uuid AND id = ${ids.categoryId}::uuid
        FOR SHARE`
    : [];
  if (!engagement || (ids.categoryId && !category)) throw notFound();
  if (engagement.status !== 'ACTIVE' || ids.clientArchived) throw refusal('NO_OPEN_SERVICE');
  if (category?.archived_at) throw refusal('CATEGORY_ARCHIVED');
  return {
    engagement: { id: engagement.id, taxYear: engagement.taxYear },
    category: category ? { id: category.id, retentionYears: category.retention_years } : null,
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

/** Keeps the engagement's status as it is until the transaction ends. */
export async function holdEngagement(tx: TxClient, businessId: string, id: string): Promise<void> {
  await tx.$queryRaw`SELECT 1 FROM engagements
    WHERE business_id = ${businessId}::uuid AND id = ${id}::uuid FOR SHARE`;
}
