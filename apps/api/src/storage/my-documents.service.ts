import { Inject, Injectable } from '@nestjs/common';
import type { Database, Prisma, TxClient } from '@firmivra/db';
import {
  type CreateMyUploadRequest,
  type DownloadLink,
  type ListMyDocumentsQuery,
  type MyDocument,
  type MyDocumentCategory,
  type MyDocumentList,
  PORTAL_BLOCKED_TEXT,
  TAX_SERVICE_KINDS,
  type UploadTargets,
  type UploadTicket,
} from '@firmivra/types';
import type { z } from 'zod';
import { AuditService } from '../audit/audit.service.js';
import { decodeCursor, encodeCursor, likeEscape } from '../clients/clients.service.js';
import { DATABASE } from '../database/database.module.js';
import {
  badCursor,
  decodeNameCursor,
  type DocumentRow,
  documentSelect,
  encodeNameCursor,
  findTarget,
  forbidden,
  lockClient,
  notFound,
  OPEN_REQUEST,
  peopleOf,
  type PortalCaller,
  type PortalLogin,
  portalLogin,
  sourceOf,
  toMyDocument,
} from './document-records.js';
import { UploadsService } from './uploads.service.js';

type ListQuery = z.output<typeof ListMyDocumentsQuery>;
type UploadBody = z.output<typeof CreateMyUploadRequest>;
type Source = ListQuery['source'];

const isTax = (kind: string) => (TAX_SERVICE_KINDS as readonly string[]).includes(kind);
const day = (d: Date | null) => d?.toISOString().slice(0, 10) ?? null;

/**
 * The documents this login may see in a source; null when it may see none there. Never INTERNAL
 * and never another client's. Household logins (Rasel, q12): PRIMARY and SPOUSE see every upload
 * of the household (MINE) and the firm's shared files (FIRM); an AUTHORIZED login sees only its
 * own uploads, and FIRM is empty for it.
 */
function visible(login: PortalLogin, source: Source): Prisma.DocumentWhereInput | null {
  if (!login.clientId) return null;
  const theirs = { businessId: login.businessId, clientId: login.clientId };
  if (source === 'FIRM') return login.household ? { ...theirs, direction: 'FIRM_TO_CLIENT' } : null;
  return login.household
    ? { ...theirs, direction: 'CLIENT_TO_FIRM' }
    : { ...theirs, direction: 'CLIENT_TO_FIRM', uploadedByUserId: login.userId };
}

/**
 * The signed-in client's documents at one firm (portal My Documents and the Upload Documents
 * pop-up; R5 API part 2). The client comes from the session's login, never the URL. Uploads use
 * part 1's three steps with the token bound to this login; an AUTHORIZED login uploads only for
 * an open request (403 without one). Every list, view, download link and upload is audited with
 * ids only.
 */
@Injectable()
export class MyDocumentsService {
  constructor(
    @Inject(DATABASE) private readonly database: Database,
    private readonly uploads: UploadsService,
    private readonly audit: AuditService,
  ) {}

  private inFirm<T>(businessId: string, fn: (tx: TxClient) => Promise<T>): Promise<T> {
    return this.database.withScope({ kind: 'business', businessId }, fn);
  }

  /** A document this login may see (either source); else 404. */
  private async find(tx: TxClient, login: PortalLogin, id: string): Promise<DocumentRow> {
    const sources = [visible(login, 'MINE'), visible(login, 'FIRM')].filter((w) => w !== null);
    const row = sources.length
      ? await tx.document.findFirst({
          where: { AND: [{ id }, { OR: sources }] },
          select: documentSelect,
        })
      : null;
    if (!row) throw notFound();
    return row;
  }

  /** One page of MINE or FIRM, newest first or by file name, with the source's tax years. */
  async list(caller: PortalCaller, q: ListQuery): Promise<MyDocumentList> {
    const { result, clientId } = await this.inFirm(caller.businessId, async (tx) => {
      const login = await portalLogin(tx, caller);
      const source = visible(login, q.source);
      const empty = { items: [], nextCursor: null, years: [] };
      if (!source) return { result: empty, clientId: login.clientId };
      const byName = q.sort === 'name';
      const term = q.search ? likeEscape(q.search) : undefined;
      const rows = await tx.document.findMany({
        where: {
          AND: [
            source,
            q.categoryId ? { categoryId: q.categoryId } : {},
            q.taxYear ? { taxYear: q.taxYear } : {},
            term ? { fileName: { contains: term, mode: 'insensitive' } } : {},
            q.cursor ? await this.after(tx, source, byName, q.cursor) : {},
          ],
        },
        orderBy: byName
          ? [{ fileName: 'asc' }, { id: 'asc' }]
          : [{ createdAt: 'desc' }, { id: 'desc' }],
        take: q.limit + 1,
        select: documentSelect,
      });
      const years = await tx.document.findMany({
        where: { AND: [source, { taxYear: { not: null } }] },
        distinct: ['taxYear'],
        orderBy: { taxYear: 'desc' },
        select: { taxYear: true },
      });
      const page = rows.slice(0, q.limit);
      const people = await peopleOf(
        tx,
        page.map((r) => r.uploadedByUserId),
      );
      const last = page.at(-1);
      const next = rows.length > q.limit && last;
      return {
        result: {
          items: page.map((r) => toMyDocument(r, people)),
          nextCursor: next ? (byName ? encodeNameCursor(last.id) : encodeCursor(last)) : null,
          years: years.flatMap((y) => (y.taxYear === null ? [] : [y.taxYear])),
        },
        clientId: login.clientId,
      };
    });
    if (clientId) {
      await this.audit.log(
        'documents.listed',
        { type: 'client', id: clientId },
        { source: q.source, count: result.items.length, clientAccountId: caller.clientAccountId },
      );
    }
    return result;
  }

  /** Rows after the cursor's row, in the list's order (the row must be one this list shows). */
  private async after(
    tx: TxClient,
    source: Prisma.DocumentWhereInput,
    byName: boolean,
    cursor: string,
  ): Promise<Prisma.DocumentWhereInput> {
    if (!byName) {
      const at = decodeCursor(cursor);
      return {
        OR: [{ createdAt: { lt: at.createdAt } }, { createdAt: at.createdAt, id: { lt: at.id } }],
      };
    }
    const anchor = await tx.document.findFirst({
      where: { AND: [source, { id: decodeNameCursor(cursor) }] },
      select: { id: true, fileName: true },
    });
    if (!anchor) throw badCursor();
    return {
      OR: [
        { fileName: { gt: anchor.fileName } },
        { fileName: anchor.fileName, id: { gt: anchor.id } },
      ],
    };
  }

  async get(caller: PortalCaller, id: string): Promise<MyDocument> {
    const { row, doc } = await this.inFirm(caller.businessId, async (tx) => {
      const row = await this.find(tx, await portalLogin(tx, caller), id);
      return { row, doc: toMyDocument(row, await peopleOf(tx, [row.uploadedByUserId])) };
    });
    await this.audit.log(
      'document.viewed',
      { type: 'document', id: row.id },
      { clientId: row.clientId, clientAccountId: caller.clientAccountId },
    );
    return doc;
  }

  /**
   * A 5-minute link. 404 first, then 409 SCAN_PENDING or FILE_BLOCKED, the latter in the words of
   * PORTAL_BLOCKED_TEXT for the document's source (never that it failed the malware scan).
   */
  async download(caller: PortalCaller, id: string): Promise<DownloadLink> {
    const row = await this.inFirm(caller.businessId, async (tx) =>
      this.find(tx, await portalLogin(tx, caller), id),
    );
    const blocked = PORTAL_BLOCKED_TEXT[sourceOf(row)];
    return this.uploads.downloadLink(row, { blocked, clientAccountId: caller.clientAccountId });
  }

  /**
   * The open (ACTIVE) services the Upload Documents pop-up may offer, with their open requests
   * (soonest due first). Empty lists are the STOP state: no linked client, an archived client or
   * no open service. An AUTHORIZED login gets only the services with an open request.
   */
  async uploadTargets(caller: PortalCaller): Promise<UploadTargets> {
    const { targets, clientId } = await this.inFirm(caller.businessId, async (tx) => {
      const login = await portalLogin(tx, caller);
      const none = { targets: { tax: [], business: [] }, clientId: login.clientId };
      if (!login.clientId) return none;
      const client = await tx.client.findFirst({
        where: { businessId: caller.businessId, id: login.clientId, archivedAt: null },
        select: { id: true },
      });
      if (!client) return none;
      const engagements = await tx.engagement.findMany({
        where: { businessId: caller.businessId, clientId: login.clientId, status: 'ACTIVE' },
        orderBy: [{ taxYear: { sort: 'desc', nulls: 'last' } }, { title: 'asc' }, { id: 'asc' }],
        select: { id: true, title: true, taxYear: true, service: { select: { kind: true } } },
        take: 100,
      });
      const requests = await tx.documentRequest.findMany({
        where: {
          businessId: caller.businessId,
          clientId: login.clientId,
          status: { in: [...OPEN_REQUEST] },
          engagementId: { in: engagements.map((e) => e.id) },
        },
        orderBy: [{ dueOn: { sort: 'asc', nulls: 'last' } }, { createdAt: 'asc' }],
        select: { id: true, title: true, dueOn: true, engagementId: true },
        take: 200,
      });
      const all = engagements
        .map((e) => ({
          tax: isTax(e.service.kind),
          target: {
            serviceId: e.id,
            title: e.title,
            taxYear: e.taxYear,
            openRequests: requests
              .filter((r) => r.engagementId === e.id)
              .map((r) => ({ id: r.id, title: r.title, dueOn: day(r.dueOn) })),
          },
        }))
        .filter((t) => login.household || t.target.openRequests.length > 0);
      return {
        targets: {
          tax: all.filter((t) => t.tax).map((t) => t.target),
          business: all.filter((t) => !t.tax).map((t) => t.target),
        },
        clientId: login.clientId,
      };
    });
    if (clientId) {
      await this.audit.log(
        'documents.upload_targets_viewed',
        { type: 'client', id: clientId },
        {
          services: targets.tax.length + targets.business.length,
          clientAccountId: caller.clientAccountId,
        },
      );
    }
    return targets;
  }

  /**
   * Step 1 of the client's upload: 403 for an AUTHORIZED login without a request; 404 for a
   * service, request or category that isn't the client's or the firm's; then 409
   * NO_OPEN_SERVICE (also for an archived client), REQUEST_CLOSED or CATEGORY_ARCHIVED. The tax
   * year defaults to the service's.
   */
  async createUpload(caller: PortalCaller, body: UploadBody): Promise<UploadTicket> {
    const { clientId, target } = await this.inFirm(caller.businessId, async (tx) => {
      const login = await portalLogin(tx, caller);
      if (!login.household && !body.requestId) throw forbidden();
      const client = login.clientId && (await lockClient(tx, caller.businessId, login.clientId));
      if (!login.clientId || !client) throw notFound();
      const target = await findTarget(tx, caller.businessId, login.clientId, {
        ...body,
        clientArchived: client.archived,
      });
      return { clientId: login.clientId, target };
    });
    return this.uploads.ticket({
      pool: 'CLIENT',
      businessId: caller.businessId,
      userId: caller.userId,
      clientAccountId: caller.clientAccountId,
      clientId,
      engagementId: target.engagement.id,
      requestId: target.request?.id ?? null,
      categoryId: body.categoryId ?? null,
      direction: 'CLIENT_TO_FIRM',
      taxYear: body.taxYear ?? target.engagement.taxYear,
      fileName: body.fileName,
      contentType: body.contentType,
      sizeBytes: body.sizeBytes,
      sha256: body.sha256,
    });
  }

  /**
   * Step 3. 410 UPLOAD_EXPIRED (also for a token made for another login); 409 UPLOAD_MISMATCH,
   * FILE_PASSWORD_PROTECTED or FILE_HAS_MACROS; the login must still belong to the client (404)
   * and still be allowed the upload (403), and the service and request still open (409). The new
   * file is CHECKING until scanned.
   */
  async confirmUpload(caller: PortalCaller, uploadToken: string): Promise<MyDocument> {
    const id = await this.uploads.confirm(
      { pool: 'CLIENT', ...caller },
      uploadToken,
      async (tx, claim) => {
        const login = await portalLogin(tx, caller);
        if (login.clientId !== claim.clientId) throw notFound();
        if (!login.household && !claim.requestId) throw forbidden();
        const client = await lockClient(tx, caller.businessId, claim.clientId);
        if (!client) throw notFound();
        return { archived: client.archived };
      },
    );
    return this.inFirm(caller.businessId, async (tx) => {
      const row = await this.find(tx, await portalLogin(tx, caller), id);
      return toMyDocument(row, await peopleOf(tx, [row.uploadedByUserId]));
    });
  }

  /** The firm's active categories, in order. */
  async categories(caller: PortalCaller): Promise<MyDocumentCategory[]> {
    return this.database.forBusiness(caller.businessId).documentCategory.findMany({
      where: { businessId: caller.businessId, archivedAt: null },
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
      select: { id: true, name: true },
      take: 500,
    });
  }
}
