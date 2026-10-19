import { Inject, Injectable, Logger } from '@nestjs/common';
import type { Database, Prisma, TxClient } from '@firmivra/db';
import type { DocumentAccess, DocumentShare } from '@firmivra/types';
import type { z } from 'zod';
import { AuditService } from '../audit/audit.service.js';
import type { TenantContext } from '../common/request-context.js';
import { DATABASE } from '../database/database.module.js';
import { errorName, Notifier } from '../notifications/notifier.js';
import { notFound } from '../storage/document-records.js';
import { isUniqueViolation, memberNames, memberRef } from '../workspaces/common.js';
import { actorOf, conflict, docReach, invalid, requireActiveMember } from './library.common.js';
import type { CreateShareBody, UpdateShareBody } from './library.input.js';

type Out<S extends z.ZodType> = z.output<S>;

const shareSelect = {
  id: true,
  recipientKind: true,
  clientAccountId: true,
  memberUserId: true,
  canDownload: true,
  canUpload: true,
  canSign: true,
  expiresAt: true,
  grantedByUserId: true,
  createdAt: true,
  clientAccount: { select: { id: true, email: true, user: { select: { name: true } } } },
  member: { select: { userId: true, user: { select: { name: true, email: true } } } },
} satisfies Prisma.DocumentShareSelect;
type ShareRow = Prisma.DocumentShareGetPayload<{ select: typeof shareSelect }>;

const exists = () => conflict('SHARE_EXISTS', 'This person already has access: change it instead');

/**
 * Frame 5, Share Document / Manage Access (R55): grants to the document's own client's portal
 * logins (never for an INTERNAL document) or to members, with download, upload (a new version,
 * never an overwrite), sign and an expiry. Revoked, never deleted; no public or external links.
 */
@Injectable()
export class DocumentSharesService {
  private readonly logger = new Logger(DocumentSharesService.name);

  constructor(
    @Inject(DATABASE) private readonly database: Database,
    private readonly audit: AuditService,
    private readonly notifier: Notifier,
  ) {}

  private inFirm<T>(tenant: TenantContext, fn: (tx: TxClient) => Promise<T>): Promise<T> {
    return this.database.withScope({ kind: 'business', businessId: tenant.businessId }, fn);
  }

  private async document(tx: TxClient, tenant: TenantContext, userId: string, id: string) {
    const doc = await tx.document.findFirst({
      where: { AND: [{ businessId: tenant.businessId, id }, docReach(actorOf(userId, tenant))] },
      select: {
        id: true,
        clientId: true,
        fileName: true,
        versionNo: true,
        direction: true,
        trashedAt: true,
      },
    });
    if (!doc) throw notFound();
    return doc;
  }

  private toShare(r: ShareRow, names: Map<string, string>): DocumentShare {
    const recipient =
      r.recipientKind === 'CLIENT'
        ? {
            kind: 'CLIENT' as const,
            id: r.clientAccount!.id,
            name: r.clientAccount!.user.name,
            email: r.clientAccount!.email,
          }
        : {
            kind: 'MEMBER' as const,
            id: r.member!.userId,
            name: r.member!.user.name,
            email: r.member!.user.email,
          };
    return {
      id: r.id,
      recipient,
      canDownload: r.canDownload,
      canUpload: r.canUpload,
      canSign: r.canSign,
      expiresAt: r.expiresAt?.toISOString() ?? null,
      grantedBy: memberRef(names, r.grantedByUserId),
      createdAt: r.createdAt.toISOString(),
    };
  }

  /** GET /business/documents/{id}/access: live grants and the client's portal logins. */
  async access(tenant: TenantContext, userId: string, id: string): Promise<DocumentAccess> {
    const businessId = tenant.businessId;
    return this.inFirm(tenant, async (tx) => {
      const doc = await this.document(tx, tenant, userId, id);
      const [shares, logins] = await Promise.all([
        tx.documentShare.findMany({
          where: { businessId, documentId: id, revokedAt: null },
          orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
          select: shareSelect,
        }),
        tx.clientAccount.findMany({
          where: { businessId, clientId: doc.clientId, status: 'ACTIVE' },
          orderBy: [{ portalRole: 'asc' }, { createdAt: 'asc' }],
          select: { id: true, email: true, portalRole: true, user: { select: { name: true } } },
        }),
      ]);
      const names = await memberNames(
        tx,
        businessId,
        shares.map((s) => s.grantedByUserId),
      );
      return {
        document: {
          id: doc.id,
          fileName: doc.fileName,
          versionNo: doc.versionNo,
          direction: doc.direction,
        },
        shares: shares.map((s) => this.toShare(s, names)),
        clientLogins: logins.map((l) => ({
          id: l.id,
          name: l.user.name,
          email: l.email,
          primary: l.portalRole === 'PRIMARY',
        })),
      };
    });
  }

  private future(expiresAt: string | null | undefined) {
    if (expiresAt && Date.parse(expiresAt) <= Date.now()) {
      throw invalid('Choose an expiry in the future', 'expiresAt');
    }
  }

  /** POST /business/documents/{id}/shares. */
  async share(
    tenant: TenantContext,
    userId: string,
    id: string,
    body: Out<typeof CreateShareBody>,
  ): Promise<DocumentShare> {
    const businessId = tenant.businessId;
    this.future(body.expiresAt);
    const share = await this.inFirm(tenant, async (tx) => {
      const doc = await this.document(tx, tenant, userId, id);
      if (doc.trashedAt) throw conflict('INVALID_STATUS', 'Restore the document from Trash first');
      if (body.recipient.kind === 'CLIENT') {
        if (doc.direction === 'INTERNAL') {
          throw conflict(
            'INTERNAL_DOCUMENT',
            'An internal document is never shared with the client',
          );
        }
        const login = await tx.clientAccount.findFirst({
          where: {
            businessId,
            id: body.recipient.clientAccountId,
            clientId: doc.clientId,
            status: 'ACTIVE',
          },
          select: { id: true },
        });
        if (!login) throw notFound();
      } else {
        await requireActiveMember(tx, businessId, body.recipient.userId);
      }
      const row = await tx.documentShare
        .create({
          data: {
            businessId,
            documentId: id,
            recipientKind: body.recipient.kind,
            clientAccountId:
              body.recipient.kind === 'CLIENT' ? body.recipient.clientAccountId : null,
            memberUserId: body.recipient.kind === 'MEMBER' ? body.recipient.userId : null,
            canDownload: body.canDownload,
            canUpload: body.canUpload,
            canSign: body.canSign,
            expiresAt: body.expiresAt ? new Date(body.expiresAt) : null,
            grantedByUserId: userId,
          },
          select: shareSelect,
        })
        .catch((e: unknown) => {
          if (isUniqueViolation(e)) throw exists();
          throw e;
        });
      await this.audit.logIn(
        tx,
        'document.shared',
        { type: 'document', id },
        { shareId: row.id, recipientKind: body.recipient.kind },
        { businessId },
      );
      return this.toShare(row, await memberNames(tx, businessId, [userId]));
    });
    if (body.notify && body.recipient.kind === 'CLIENT') {
      try {
        await this.notifier.notify({
          businessId,
          event: 'document.shared',
          recordId: id,
          actorUserId: userId,
        });
      } catch (error) {
        this.logger.warn(`document.shared for document ${id} not written (${errorName(error)})`);
      }
    }
    return share;
  }

  private async liveShare(tx: TxClient, businessId: string, id: string, shareId: string) {
    await tx.$executeRaw`SELECT 1 FROM document_shares WHERE business_id = ${businessId}::uuid AND id = ${shareId}::uuid FOR UPDATE`;
    const s = await tx.documentShare.findFirst({
      where: { businessId, id: shareId, documentId: id },
      select: { id: true, revokedAt: true },
    });
    if (!s) throw notFound();
    return s;
  }

  /** PATCH /business/documents/{id}/shares/{shareId}: permissions and expiry. */
  async update(
    tenant: TenantContext,
    userId: string,
    id: string,
    shareId: string,
    body: Out<typeof UpdateShareBody>,
  ): Promise<DocumentShare> {
    const businessId = tenant.businessId;
    this.future(body.expiresAt);
    const fields = Object.keys(body).filter(
      (k) => (body as Record<string, unknown>)[k] !== undefined,
    );
    return this.inFirm(tenant, async (tx) => {
      await this.document(tx, tenant, userId, id);
      const s = await this.liveShare(tx, businessId, id, shareId);
      if (s.revokedAt)
        throw conflict('INVALID_STATUS', 'This access was revoked: share again instead');
      const row = await tx.documentShare.update({
        where: { id: shareId },
        data: {
          ...(body.canDownload !== undefined ? { canDownload: body.canDownload } : {}),
          ...(body.canUpload !== undefined ? { canUpload: body.canUpload } : {}),
          ...(body.canSign !== undefined ? { canSign: body.canSign } : {}),
          ...(body.expiresAt !== undefined
            ? { expiresAt: body.expiresAt ? new Date(body.expiresAt) : null }
            : {}),
        },
        select: shareSelect,
      });
      await this.audit.logIn(
        tx,
        'document.share_changed',
        { type: 'document', id },
        { shareId, fields: fields.sort() },
        { businessId },
      );
      return this.toShare(row, await memberNames(tx, businessId, [row.grantedByUserId]));
    });
  }

  /** POST .../shares/{shareId}/revoke. Repeating is harmless. */
  async revoke(
    tenant: TenantContext,
    userId: string,
    id: string,
    shareId: string,
  ): Promise<{ ok: true }> {
    const businessId = tenant.businessId;
    await this.inFirm(tenant, async (tx) => {
      await this.document(tx, tenant, userId, id);
      const s = await this.liveShare(tx, businessId, id, shareId);
      if (s.revokedAt) return;
      await tx.documentShare.update({
        where: { id: shareId },
        data: { revokedAt: new Date(), revokedByUserId: userId },
      });
      await this.audit.logIn(
        tx,
        'document.share_revoked',
        { type: 'document', id },
        { shareId },
        { businessId },
      );
    });
    return { ok: true };
  }
}
