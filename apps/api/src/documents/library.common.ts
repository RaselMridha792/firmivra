import { BadRequestException, ConflictException, ForbiddenException } from '@nestjs/common';
import { databaseErrorCode, type Prisma, type TxClient } from '@firmivra/db';
import type { LibraryDocument } from '@firmivra/types';
import { legacyFirmRole, type TenantContext } from '../common/request-context.js';
import type { PermissionGrantsService } from '../roles/permission-grants.service.js';
import type { FirmActor } from '../storage/document-records.js';
import { memberNames, memberRef } from '../workspaces/common.js';

// Shared by the firm-wide Documents library (R55; contract packages/types/src/documents/library.ts).

export const invalid = (message: string, path?: string) =>
  new BadRequestException({ code: 'VALIDATION_FAILED', message, ...(path ? { path } : {}) });
export const conflict = (code: string, message: string) => new ConflictException({ code, message });
export const notAMember = () =>
  conflict('NOT_A_MEMBER', 'The reviewer or assignee is not an active member of the firm');

/** The signed-in member as R5's document helpers take them. */
export function actorOf(userId: string, tenant: TenantContext): FirmActor {
  return { userId, role: legacyFirmRole(tenant.role as Parameters<typeof legacyFirmRole>[0]) };
}

/** Staff reach the documents of the clients assigned to them; Owner and Admin every one. */
export const docReach = (actor: FirmActor): Prisma.DocumentWhereInput =>
  actor.role === 'STAFF' ? { engagement: { client: { assignedUserId: actor.userId } } } : {};

/** A live grant: not revoked and not past its expiry. */
export const liveShare = (): Prisma.DocumentShareWhereInput => ({
  revokedAt: null,
  OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
});

export const librarySelect = {
  id: true,
  fileName: true,
  contentType: true,
  sizeBytes: true,
  sha256: true,
  s3Key: true,
  clientId: true,
  requestId: true,
  direction: true,
  taxYear: true,
  description: true,
  tags: true,
  reviewStatus: true,
  reviewerUserId: true,
  reviewedAt: true,
  reviewedByUserId: true,
  scanStatus: true,
  expiresOn: true,
  versionNo: true,
  replacesId: true,
  supersededAt: true,
  uploadedByUserId: true,
  createdAt: true,
  updatedAt: true,
  archivedAt: true,
  trashedAt: true,
  engagement: {
    select: { id: true, title: true, client: { select: { id: true, displayName: true } } },
  },
  folder: { select: { id: true, name: true, color: true } },
  category: { select: { id: true, name: true } },
  documentShares: {
    where: { recipientKind: 'CLIENT' as const, ...liveShare() },
    select: { id: true },
    take: 1,
  },
} satisfies Prisma.DocumentSelect;
export type LibraryRow = Prisma.DocumentGetPayload<{ select: typeof librarySelect }>;

const day = (d: Date | null) => d?.toISOString().slice(0, 10) ?? null;

/** The names the rows need: members (reviewer, reviewed by) and uploaders (members or clients). */
export async function namesFor(tx: TxClient, businessId: string, rows: LibraryRow[]) {
  const members = await memberNames(
    tx,
    businessId,
    rows.flatMap((r) => [r.reviewerUserId, r.reviewedByUserId]),
  );
  const ids = [...new Set(rows.map((r) => r.uploadedByUserId).filter((x): x is string => !!x))];
  const users = ids.length
    ? await tx.user.findMany({
        where: { id: { in: ids } },
        select: { id: true, name: true, pool: true },
      })
    : [];
  const uploaders = new Map(
    users.map((u) => [u.id, { name: u.name, byClient: u.pool === 'CLIENT' }]),
  );
  return { members, uploaders };
}

export function toLibraryDocument(
  r: LibraryRow,
  names: Awaited<ReturnType<typeof namesFor>>,
): LibraryDocument {
  return {
    id: r.id,
    fileName: r.fileName,
    contentType: r.contentType,
    sizeBytes: r.sizeBytes,
    client: { id: r.engagement.client.id, name: r.engagement.client.displayName },
    service: { id: r.engagement.id, title: r.engagement.title },
    folder: r.folder,
    category: r.category,
    direction: r.direction,
    taxYear: r.taxYear,
    description: r.description,
    tags: r.tags,
    reviewStatus: r.reviewStatus,
    reviewer: memberRef(names.members, r.reviewerUserId),
    reviewedAt: r.reviewedAt?.toISOString() ?? null,
    reviewedBy: memberRef(names.members, r.reviewedByUserId),
    scanStatus: r.scanStatus,
    expiresOn: day(r.expiresOn),
    versionNo: r.versionNo,
    replacesId: r.replacesId,
    superseded: r.supersededAt !== null,
    requestId: r.requestId,
    visibleToClient: r.direction !== 'INTERNAL' || r.documentShares.length > 0,
    uploadedBy: r.uploadedByUserId ? (names.uploaders.get(r.uploadedByUserId) ?? null) : null,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
    archivedAt: r.archivedAt?.toISOString() ?? null,
    trashedAt: r.trashedAt?.toISOString() ?? null,
  };
}

/** An active member of the firm (FOR SHARE), for a reviewer or default reviewer; 409 otherwise. */
export async function requireActiveMember(tx: TxClient, businessId: string, userId: string) {
  const [m] = await tx.$queryRaw<{ status: string }[]>`
    SELECT status::text AS status FROM memberships
    WHERE business_id = ${businessId}::uuid AND user_id = ${userId}::uuid FOR SHARE`;
  if (m?.status !== 'ACTIVE') throw notAMember();
}

/** A live folder of the firm, with its scope; 404 when there is none. */
export async function liveFolder(tx: TxClient, businessId: string, id: string) {
  const f = await tx.documentFolder.findFirst({
    where: { businessId, id, archivedAt: null },
    select: { id: true, scope: true, parentId: true },
  });
  return f;
}

/** The database's rules (check_violation) as a 409 with the given code; anything else rethrown. */
export function rethrowCheck(error: unknown, code: string, message: string): never {
  if (databaseErrorCode(error) === '23514') throw conflict(code, message);
  throw error;
}

/**
 * The grid's DELETE or MANAGE for legacy Staff, whom `@Roles` lets in without the grid (the other
 * roles went through it in the guard): 403 unless the firm gives Staff that capability.
 */
export async function requireCapability(
  grants: PermissionGrantsService,
  tenant: TenantContext,
  capability: 'DELETE' | 'MANAGE',
): Promise<void> {
  if (tenant.role !== 'STAFF') return;
  if (!(await grants.canTenant(tenant, 'DOCUMENTS', capability))) {
    throw new ForbiddenException({
      code: 'FORBIDDEN',
      message: 'You do not have access to this action',
    });
  }
}
