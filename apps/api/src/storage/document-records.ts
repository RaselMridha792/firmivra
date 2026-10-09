import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  GoneException,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import type { DocumentRequestStatus, Prisma, TxClient } from '@firmivra/db';
import {
  DOCUMENT_ERRORS,
  type DocumentErrorCode,
  type FirmDocument,
  type FirmDocumentRequest,
  type MyDocument,
  type MyDocumentRequest,
} from '@firmivra/types';

// Rules and shapes shared by the firm and portal sides of the documents module (R5).

/** A 409 (410 for UPLOAD_EXPIRED) with the words users see (DOCUMENT_ERRORS). */
export const refusal = (code: DocumentErrorCode, message: string = DOCUMENT_ERRORS[code]) =>
  code === 'UPLOAD_EXPIRED'
    ? new GoneException({ code, message })
    : new ConflictException({ code, message });
export const notFound = () => new NotFoundException({ code: 'NOT_FOUND', message: 'Not found' });
/** 403: a household rule (Rasel, q12) keeps this portal login from it (AUTHORIZED logins). */
export const forbidden = () =>
  new ForbiddenException({ code: 'FORBIDDEN', message: 'This action is not permitted' });
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

/** Requests the client can still answer: an upload for one makes it SUBMITTED. */
export const OPEN_REQUEST: readonly DocumentRequestStatus[] = ['REQUESTED', 'REJECTED'];

/** Who acts on the firm side: the signed-in member and their role here (from TenantGuard). */
export interface FirmActor {
  userId: string;
  role: 'OWNER' | 'ADMIN' | 'STAFF';
}

/** Staff reach only the clients assigned to them; Owner and Admin every client. Others are 404. */
export const clientReach = (actor: FirmActor): Prisma.ClientWhereInput =>
  actor.role === 'STAFF' ? { assignedUserId: actor.userId } : {};

/** The client, if this member may reach it; else 404. For reads (changes lock it instead). */
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
 * The client row, locked FOR SHARE until the transaction ends (the #108 review: tasks, reports
 * and appointments lock the client first), so a reassignment or an archive at the same time
 * waits for the upload or the request change, or has committed and is seen here. Null when the
 * firm has no such client. Lock order: the client, the engagement, the category, the request.
 */
export async function lockClient(tx: TxClient, businessId: string, clientId: string) {
  const [row] = await tx.$queryRaw<{ archived_at: Date | null; assigned_user_id: string | null }[]>`
    SELECT archived_at, assigned_user_id::text AS assigned_user_id FROM clients
    WHERE business_id = ${businessId}::uuid AND id = ${clientId}::uuid
    FOR SHARE`;
  return row ? { archived: row.archived_at !== null, assignedTo: row.assigned_user_id } : null;
}

/** `lockClient` for a firm member: 404 when they don't reach it (Staff: not assigned to them). */
export async function lockReachableClient(
  tx: TxClient,
  businessId: string,
  actor: FirmActor,
  clientId: string,
): Promise<{ archived: boolean }> {
  const client = await lockClient(tx, businessId, clientId);
  const reached =
    client && (actor.role !== 'STAFF' || client.assignedTo === actor.userId.toLowerCase());
  if (!reached) throw notFound();
  return { archived: client.archived };
}

/** The request row, locked FOR UPDATE until the transaction ends (Prisma has no FOR UPDATE). */
export async function lockRequest(tx: TxClient, businessId: string, id: string) {
  const [row] = await tx.$queryRaw<
    { client_id: string; engagement_id: string; status: DocumentRequestStatus }[]
  >`
    SELECT client_id::text AS client_id, engagement_id::text AS engagement_id,
           status::text AS status
    FROM document_requests
    WHERE business_id = ${businessId}::uuid AND id = ${id}::uuid
    FOR UPDATE`;
  return row ?? null;
}

export interface Target {
  engagement: { id: string; taxYear: number | null };
  category: { id: string; retentionYears: number | null } | null;
  /** The open request an upload answers (REQUESTED or REJECTED), locked FOR UPDATE. */
  request: { id: string; status: DocumentRequestStatus } | null;
}

/**
 * The service (engagement), category and request an upload or a new request names, all of this
 * client and firm: every 404 before any 409. Then NO_OPEN_SERVICE (the engagement is not ACTIVE,
 * or the client is archived), REQUEST_CLOSED (the request is of another service, or not open)
 * and CATEGORY_ARCHIVED. The category is read FOR SHARE and the request FOR UPDATE, so an archive
 * or a decision at the same time waits for the upload or is seen here (lock order: the client,
 * the engagement, the category, the request).
 */
export async function findTarget(
  tx: TxClient,
  businessId: string,
  clientId: string,
  ids: {
    serviceId: string;
    categoryId?: string | null;
    requestId?: string | null;
    clientArchived: boolean;
  },
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
  const request = ids.requestId ? await lockRequest(tx, businessId, ids.requestId) : null;
  const theirs = !ids.requestId || request?.client_id === clientId.toLowerCase();
  if (!engagement || (ids.categoryId && !category) || !theirs) throw notFound();
  if (engagement.status !== 'ACTIVE' || ids.clientArchived) throw refusal('NO_OPEN_SERVICE');
  if (request && (request.engagement_id !== engagement.id || !isOpen(request.status))) {
    throw refusal('REQUEST_CLOSED');
  }
  if (category?.archived_at) throw refusal('CATEGORY_ARCHIVED');
  return {
    engagement: { id: engagement.id, taxYear: engagement.taxYear },
    category: category ? { id: category.id, retentionYears: category.retention_years } : null,
    request: request && ids.requestId ? { id: ids.requestId, status: request.status } : null,
  };
}

export const isOpen = (status: DocumentRequestStatus) => OPEN_REQUEST.includes(status);

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

const service = (row: { engagement: { id: string; title: string } }) => ({
  id: row.engagement.id,
  title: row.engagement.title,
});
const day = (d: Date | null) => d?.toISOString().slice(0, 10) ?? null;

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

/** The portal never learns which: INFECTED and FAILED are both BLOCKED (PORTAL_BLOCKED_TEXT). */
const PORTAL_STATUS = {
  PENDING: 'CHECKING',
  CLEAN: 'READY',
  INFECTED: 'BLOCKED',
  FAILED: 'BLOCKED',
} as const;

/** The portal's source of a CLIENT_TO_FIRM or FIRM_TO_CLIENT row (INTERNAL never gets here). */
export const sourceOf = (row: DocumentRow): MyDocument['source'] =>
  row.direction === 'CLIENT_TO_FIRM' ? 'MINE' : 'FIRM';

/**
 * A document as the portal shows it. `uploadedBy` names the household login for its own uploads
 * (MINE) and is null for the firm's files: no staff names reach the portal.
 */
export function toMyDocument(row: DocumentRow, people: People): MyDocument {
  const source = sourceOf(row);
  const by = source === 'MINE' && row.uploadedByUserId ? people.get(row.uploadedByUserId) : null;
  return {
    id: row.id,
    source,
    service: service(row),
    category: row.category,
    requestId: row.requestId,
    fileName: row.fileName,
    contentType: row.contentType,
    sizeBytes: row.sizeBytes,
    taxYear: row.taxYear,
    status: PORTAL_STATUS[row.scanStatus],
    uploadedBy: by?.byClient ? { name: by.name } : null,
    uploadedAt: row.createdAt.toISOString(),
  };
}

export const requestSelect = {
  id: true,
  clientId: true,
  title: true,
  instructions: true,
  dueOn: true,
  status: true,
  statusNote: true,
  requestedByUserId: true,
  createdAt: true,
  resolvedAt: true,
  engagement: { select: { id: true, title: true } },
  category: { select: { id: true, name: true } },
  documents: {
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    select: { id: true, fileName: true, createdAt: true },
  },
} satisfies Prisma.DocumentRequestSelect;
export type RequestRow = Prisma.DocumentRequestGetPayload<{ select: typeof requestSelect }>;

export function toFirmRequest(row: RequestRow, people: People): FirmDocumentRequest {
  const by = row.requestedByUserId ? people.get(row.requestedByUserId) : undefined;
  return {
    id: row.id,
    clientId: row.clientId,
    service: service(row),
    category: row.category,
    title: row.title,
    instructions: row.instructions,
    dueOn: day(row.dueOn),
    status: row.status,
    statusNote: row.statusNote,
    documents: row.documents.map((d) => ({
      id: d.id,
      fileName: d.fileName,
      createdAt: d.createdAt.toISOString(),
    })),
    requestedBy:
      row.requestedByUserId && by ? { userId: row.requestedByUserId, name: by.name } : null,
    createdAt: row.createdAt.toISOString(),
    resolvedAt: row.resolvedAt?.toISOString() ?? null,
  };
}

export function toMyRequest(row: Omit<RequestRow, 'documents'>): MyDocumentRequest {
  return {
    id: row.id,
    service: service(row),
    category: row.category,
    title: row.title,
    instructions: row.instructions,
    dueOn: day(row.dueOn),
    status: row.status,
    statusNote: row.statusNote,
  };
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * The paging cursor of a list sorted by file name: the last row's id (a name can be 255
 * characters, too long for the 200-character cursor). The list finds that row again.
 */
export const encodeNameCursor = (id: string) => Buffer.from(`name|${id}`).toString('base64url');

export function decodeNameCursor(cursor: string): string {
  const [kind, id] = Buffer.from(cursor, 'base64url').toString().split('|');
  if (kind !== 'name' || !id || !UUID.test(id)) throw badCursor();
  return id;
}

export const badCursor = () =>
  new BadRequestException({ code: 'VALIDATION_FAILED', message: 'The cursor is not valid' });

/** Keeps the engagement's status as it is until the transaction ends. */
export async function holdEngagement(tx: TxClient, businessId: string, id: string): Promise<void> {
  await tx.$queryRaw`SELECT 1 FROM engagements
    WHERE business_id = ${businessId}::uuid AND id = ${id}::uuid FOR SHARE`;
}

/** The signed-in portal login (TenantGuard's client account and the session's user). */
export interface PortalCaller {
  businessId: string;
  userId: string;
  clientAccountId: string;
}

/** The login's client and what the household rules (Rasel, q12) let it do. */
export interface PortalLogin extends PortalCaller {
  /** Null while the login is not linked to a client record: it then has no documents. */
  clientId: string | null;
  /** PRIMARY and SPOUSE logins (the same access); false for an AUTHORIZED login. */
  household: boolean;
}

export async function portalLogin(tx: TxClient, caller: PortalCaller): Promise<PortalLogin> {
  const account = await tx.clientAccount.findFirst({
    where: { businessId: caller.businessId, id: caller.clientAccountId, userId: caller.userId },
    select: { clientId: true, portalRole: true },
  });
  return {
    ...caller,
    clientId: account?.clientId ?? null,
    household: account?.portalRole === 'PRIMARY' || account?.portalRole === 'SPOUSE',
  };
}
