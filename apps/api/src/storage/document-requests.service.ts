import { Inject, Injectable, Logger } from '@nestjs/common';
import type { Database, DocumentRequestStatus, Prisma, TxClient } from '@firmivra/db';
import type {
  CreateDocumentRequestRequest,
  FirmDocumentRequest,
  ListDocumentRequestsQuery,
  MyDocumentRequest,
} from '@firmivra/types';
import type { z } from 'zod';
import { AuditService } from '../audit/audit.service.js';
import { ENV } from '../config/config.module.js';
import type { Env } from '../config/env.js';
import { DATABASE } from '../database/database.module.js';
import { NOTIFY_SERVICE, type NotifyService } from '../notify/notify.types.js';
import {
  type FirmActor,
  findTarget,
  forbidden,
  holdEngagement,
  isOpen,
  lockClient,
  lockReachableClient,
  lockRequest,
  notFound,
  OPEN_REQUEST,
  peopleOf,
  type PortalCaller,
  portalLogin,
  reachableClient,
  refusal,
  type RequestRow,
  requestSelect,
  toFirmRequest,
  toMyRequest,
} from './document-records.js';

type ListQuery = z.output<typeof ListDocumentRequestsQuery>;
type CreateBody = z.output<typeof CreateDocumentRequestRequest>;
type Decision = 'accepted' | 'rejected' | 'cancelled';

/** The lists show at most this many (contract: FirmDocumentRequestList, MyDocumentRequestList). */
export const MAX_REQUESTS = 200;

const calendarDate = (value: string) => new Date(`${value}T00:00:00.000Z`);

/**
 * Document requests (R5 step 7). The firm asks for a document within an open service ("Request a
 * document"), then accepts the upload, marks it missing (the client is asked again, with the
 * reason) or cancels it; requests are never deleted. The client answers with an upload (confirm
 * makes it SUBMITTED) or "I don't have this" (NOT_AVAILABLE, with a reason). Staff reach only
 * the clients assigned to them (others are 404). Household logins (Rasel, q12): an AUTHORIZED
 * login sees only the open requests and never answers "I don't have this" (403). Changes lock
 * the client, then the request (the module's lock order). Every list and change is audited with
 * ids and codes only, never titles or reasons.
 */
@Injectable()
export class DocumentRequestsService {
  private readonly logger = new Logger(DocumentRequestsService.name);

  constructor(
    @Inject(DATABASE) private readonly database: Database,
    @Inject(NOTIFY_SERVICE) private readonly notify: NotifyService,
    @Inject(ENV) private readonly env: Env,
    private readonly audit: AuditService,
  ) {}

  private inFirm<T>(businessId: string, fn: (tx: TxClient) => Promise<T>): Promise<T> {
    return this.database.withScope({ kind: 'business', businessId }, fn);
  }

  // ---------- Firm ----------

  /** The client's requests, newest first. */
  async list(
    businessId: string,
    actor: FirmActor,
    clientId: string,
    q: ListQuery,
  ): Promise<FirmDocumentRequest[]> {
    const items = await this.inFirm(businessId, async (tx) => {
      await reachableClient(tx, businessId, actor, clientId);
      const rows = await tx.documentRequest.findMany({
        where: {
          businessId,
          clientId,
          ...(q.status && { status: q.status }),
          ...(q.serviceId && { engagementId: q.serviceId }),
        },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: MAX_REQUESTS,
        select: requestSelect,
      });
      return this.shaped(tx, rows);
    });
    await this.audit.log(
      'document_requests.listed',
      { type: 'client', id: clientId },
      { count: items.length },
    );
    return items;
  }

  /**
   * "Request a document": 404 for a client, service or category the member doesn't reach, then
   * 409 NO_OPEN_SERVICE (also for an archived client) or CATEGORY_ARCHIVED. The client's active
   * portal logins get an email (the title and due date only).
   */
  async create(
    businessId: string,
    actor: FirmActor,
    clientId: string,
    body: CreateBody,
  ): Promise<FirmDocumentRequest> {
    const request = await this.inFirm(businessId, async (tx) => {
      const { archived } = await lockReachableClient(tx, businessId, actor, clientId);
      await holdEngagement(tx, businessId, body.serviceId);
      const target = await findTarget(tx, businessId, clientId, {
        serviceId: body.serviceId,
        categoryId: body.categoryId,
        clientArchived: archived,
      });
      const row = await tx.documentRequest.create({
        data: {
          businessId,
          clientId,
          engagementId: target.engagement.id,
          categoryId: target.category?.id ?? null,
          title: body.title,
          instructions: body.instructions ?? null,
          dueOn: body.dueOn ? calendarDate(body.dueOn) : null,
          requestedByUserId: actor.userId,
        },
        select: requestSelect,
      });
      await this.audit.logIn(
        tx,
        'document_request.created',
        { type: 'document_request', id: row.id },
        {
          clientId: row.clientId,
          serviceId: row.engagement.id,
          categoryId: row.category?.id ?? null,
        },
        { businessId },
      );
      return (await this.shaped(tx, [row]))[0]!;
    });
    await this.tellClient(businessId, request);
    return request;
  }

  /**
   * Accepts the newest file (q22: only a CLEAN one). 409 REQUEST_CLOSED (accepted or cancelled),
   * NOTHING_SUBMITTED (not SUBMITTED, or no clean file), SCAN_PENDING (still being checked).
   */
  accept(businessId: string, actor: FirmActor, id: string): Promise<FirmDocumentRequest> {
    return this.decide(businessId, actor, id, 'accepted', async (tx, status) => {
      if (status !== 'SUBMITTED') throw refusal('NOTHING_SUBMITTED');
      const newest = await tx.document.findFirst({
        where: { businessId, requestId: id },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        select: { id: true, scanStatus: true },
      });
      if (newest?.scanStatus === 'PENDING') throw refusal('SCAN_PENDING');
      if (newest?.scanStatus !== 'CLEAN') throw refusal('NOTHING_SUBMITTED');
      return {
        data: { status: 'ACCEPTED', statusNote: null, resolvedAt: new Date() },
        documentId: newest.id,
      };
    });
  }

  /** "Mark missing": the reason goes to the client, who is asked again. 409 as for accept. */
  reject(
    businessId: string,
    actor: FirmActor,
    id: string,
    reason: string,
  ): Promise<FirmDocumentRequest> {
    return this.decide(businessId, actor, id, 'rejected', (_tx, status) => {
      if (status !== 'SUBMITTED') throw refusal('NOTHING_SUBMITTED');
      return Promise.resolve({ data: { status: 'REJECTED', statusNote: reason } });
    });
  }

  /** Never deleted: cancelled, whatever the client did. 409 REQUEST_CLOSED once closed. */
  cancel(businessId: string, actor: FirmActor, id: string): Promise<FirmDocumentRequest> {
    return this.decide(businessId, actor, id, 'cancelled', () =>
      Promise.resolve({ data: { status: 'CANCELLED', resolvedAt: new Date() } }),
    );
  }

  /**
   * One decision at a time per request: the client is locked (Staff must reach it, else 404),
   * then the request FOR UPDATE; an accepted or cancelled request is 409 REQUEST_CLOSED, then the
   * decision's own 409s. Audited in the same transaction.
   */
  private async decide(
    businessId: string,
    actor: FirmActor,
    id: string,
    decision: Decision,
    change: (
      tx: TxClient,
      status: DocumentRequestStatus,
    ) => Promise<{ data: Prisma.DocumentRequestUpdateInput; documentId?: string }>,
  ): Promise<FirmDocumentRequest> {
    return this.inFirm(businessId, async (tx) => {
      const found = await tx.documentRequest.findFirst({
        where: { businessId, id },
        select: { clientId: true },
      });
      if (!found) throw notFound();
      await lockReachableClient(tx, businessId, actor, found.clientId);
      const locked = await lockRequest(tx, businessId, id);
      if (!locked) throw notFound();
      if (locked.status === 'ACCEPTED' || locked.status === 'CANCELLED') {
        throw refusal('REQUEST_CLOSED');
      }
      const { data, documentId } = await change(tx, locked.status);
      const row = await tx.documentRequest.update({ where: { id }, data, select: requestSelect });
      await this.audit.logIn(
        tx,
        `document_request.${decision}`,
        { type: 'document_request', id: row.id },
        { clientId: row.clientId, from: locked.status, ...(documentId && { documentId }) },
        { businessId },
      );
      return (await this.shaped(tx, [row]))[0]!;
    });
  }

  private async shaped(tx: TxClient, rows: RequestRow[]): Promise<FirmDocumentRequest[]> {
    const people = await peopleOf(
      tx,
      rows.map((r) => r.requestedByUserId),
    );
    return rows.map((r) => toFirmRequest(r, people));
  }

  /**
   * Emails the client's active portal logins (R6 applies their preferences): the title and due
   * date only. A failure is logged with ids only and never undoes the request.
   */
  private async tellClient(businessId: string, request: FirmDocumentRequest): Promise<void> {
    try {
      const firm = this.database.forBusiness(businessId);
      const business = await firm.business.findUniqueOrThrow({
        where: { id: businessId },
        select: { slug: true },
      });
      const logins = await firm.clientAccount.findMany({
        where: { businessId, clientId: request.clientId, status: 'ACTIVE' },
        select: { id: true, email: true, user: { select: { name: true } } },
        take: 20,
      });
      const link = `${this.env.PORTAL_BASE_URL.replace(/\/+$/, '')}/${business.slug}/documents`;
      for (const login of logins) {
        await this.notify.send({
          template: 'document.requested',
          to: login.email,
          businessId,
          recipient: { clientAccountId: login.id },
          data: { name: login.user.name, title: request.title, dueOn: request.dueOn, link },
        });
      }
    } catch {
      this.logger.warn(`Could not tell the client about document request ${request.id}`);
    }
  }

  // ---------- Portal ----------

  /**
   * The client's requests, open ones first, then the newest; cancelled ones left out. An
   * AUTHORIZED login sees only the open ones.
   */
  async mine(caller: PortalCaller): Promise<MyDocumentRequest[]> {
    const { items, clientId } = await this.inFirm(caller.businessId, async (tx) => {
      const login = await portalLogin(tx, caller);
      if (!login.clientId) return { items: [], clientId: null };
      const where = { businessId: caller.businessId, clientId: login.clientId };
      const order = [{ createdAt: 'desc' }, { id: 'desc' }] as const;
      const open = await tx.documentRequest.findMany({
        where: { ...where, status: { in: [...OPEN_REQUEST] } },
        orderBy: [...order],
        take: MAX_REQUESTS,
        select: requestSelect,
      });
      const closed = login.household
        ? await tx.documentRequest.findMany({
            where: { ...where, status: { notIn: [...OPEN_REQUEST, 'CANCELLED'] } },
            orderBy: [...order],
            take: MAX_REQUESTS - open.length,
            select: requestSelect,
          })
        : [];
      return { items: [...open, ...closed].map(toMyRequest), clientId: login.clientId };
    });
    if (clientId) {
      await this.audit.log(
        'document_requests.listed',
        { type: 'client', id: clientId },
        { count: items.length, clientAccountId: caller.clientAccountId },
      );
    }
    return items;
  }

  /**
   * "I don't have this", with the client's reason: 403 for an AUTHORIZED login, 404 for a
   * request that isn't this client's, 409 NO_OPEN_SERVICE for an archived client (as its
   * uploads), then REQUEST_CLOSED unless it is open (REQUESTED or REJECTED). Lock order: the
   * client, then the request.
   */
  async notAvailable(caller: PortalCaller, id: string, reason: string): Promise<MyDocumentRequest> {
    return this.inFirm(caller.businessId, async (tx) => {
      const login = await portalLogin(tx, caller);
      if (!login.household) throw forbidden();
      const client = login.clientId && (await lockClient(tx, caller.businessId, login.clientId));
      if (!client) throw notFound();
      const locked = await lockRequest(tx, caller.businessId, id);
      if (locked?.client_id !== login.clientId) throw notFound();
      // An archived client has no open service, as for its uploads.
      if (client.archived) throw refusal('NO_OPEN_SERVICE');
      if (!isOpen(locked.status)) throw refusal('REQUEST_CLOSED');
      const row = await tx.documentRequest.update({
        where: { id },
        data: { status: 'NOT_AVAILABLE', statusNote: reason },
        select: requestSelect,
      });
      await this.audit.logIn(
        tx,
        'document_request.not_available',
        { type: 'document_request', id: row.id },
        { clientId: row.clientId, from: locked.status, clientAccountId: caller.clientAccountId },
        { businessId: caller.businessId },
      );
      return toMyRequest(row);
    });
  }
}
