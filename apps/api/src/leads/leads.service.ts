import {
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import type { Database, Prisma, TxClient } from '@firmivra/db';
import {
  type ConvertLeadRequest,
  type ConvertLeadResponse,
  type DownloadLink,
  IntakeFormDefinition,
  type LeadCounts,
  type LeadDetail,
  type LeadList,
  type LeadListItem,
  type ListLeadsQuery,
  type ReviewedLeadStatus,
} from '@firmivra/types';
import type { z } from 'zod';
import { AuditService } from '../audit/audit.service.js';
import { lockClientEmails } from '../client-auth/client-records.js';
import { type ClientsActor, decodeCursor, likeEscape } from '../clients/clients.service.js';
import { ENV } from '../config/config.module.js';
import type { Env } from '../config/env.js';
import { DATABASE } from '../database/database.module.js';
import { maskStoredNumbers } from '../intake/intake-numbers.js';
import { NotifyDeliveryError } from '../notify/notify.service.js';
import { NOTIFY_SERVICE, type NotifyService } from '../notify/notify.types.js';
import { DOCUMENT_STORAGE, type DocumentStorage } from '../storage/document-storage.js';

type ListQuery = z.output<typeof ListLeadsQuery>;
type ConvertBody = z.output<typeof ConvertLeadRequest>;

/** The statuses the firm sees: never a draft the visitor has not sent. */
const REVIEWED: ReviewedLeadStatus[] = ['SUBMITTED', 'IN_REVIEW', 'CONVERTED', 'DECLINED'];
const OPEN = ['SUBMITTED', 'IN_REVIEW'] as const;

const notFound = () => new NotFoundException({ code: 'NOT_FOUND', message: 'Not found' });
const conflict = (code: string, message: string) => new ConflictException({ code, message });
const handled = () => conflict('INVALID_STATUS', 'This lead was already handled');

const listSelect = {
  id: true,
  status: true,
  firstName: true,
  lastName: true,
  email: true,
  phone: true,
  taxYear: true,
  submittedAt: true,
  createdAt: true,
  service: { select: { id: true, name: true, kind: true } },
} satisfies Prisma.LeadSelect;

const detailSelect = {
  ...listSelect,
  reviewedAt: true,
  reviewedByUserId: true,
  declineReason: true,
  clientId: true,
  engagementId: true,
  engagement: { select: { client: { select: { id: true, displayName: true } } } },
  intakes: {
    orderBy: { createdAt: 'asc' },
    take: 1,
    select: {
      id: true,
      status: true,
      form: { select: { version: true, definition: true } },
      submissions: {
        orderBy: { version: 'desc' },
        take: 1,
        select: { answers: true },
      },
    },
  },
  uploads: {
    orderBy: { createdAt: 'asc' },
    select: {
      id: true,
      slot: true,
      fileName: true,
      contentType: true,
      sizeBytes: true,
      scanStatus: true,
      createdAt: true,
    },
  },
} satisfies Prisma.LeadSelect;

type ListRow = Prisma.LeadGetPayload<{ select: typeof listSelect }>;
type DetailRow = Prisma.LeadGetPayload<{ select: typeof detailSelect }>;

const iso = (d: Date | null) => d?.toISOString() ?? null;

function toItem(row: ListRow): LeadListItem {
  return {
    id: row.id,
    status: row.status as ReviewedLeadStatus,
    service: row.service,
    firstName: row.firstName,
    lastName: row.lastName,
    email: row.email,
    phone: row.phone,
    taxYear: row.taxYear,
    // Every lead the firm sees was sent (leads_submitted_at).
    submittedAt: (row.submittedAt ?? row.createdAt).toISOString(),
    createdAt: row.createdAt.toISOString(),
  };
}

/** The paging cursor of the inbox: the last row's sent time and id. */
const encodeCursor = (row: { submittedAt: Date | null; id: string }) =>
  Buffer.from(`${row.submittedAt?.toISOString() ?? ''}|${row.id}`).toString('base64url');

/**
 * The firm's Begin Online leads (R11 step 4). Every member of the firm sees every lead the visitor
 * sent; a draft never shows. Converting makes the client (or uses one the member reaches), an
 * ACTIVE engagement for the lead's service, gives the intake its engagement and carries each
 * upload over as a document with the same S3 key, all in one transaction; the portal invitation
 * goes out after it commits.
 */
@Injectable()
export class LeadsService {
  private readonly logger = new Logger(LeadsService.name);

  constructor(
    @Inject(DATABASE) private readonly database: Database,
    @Inject(NOTIFY_SERVICE) private readonly notify: NotifyService,
    @Inject(DOCUMENT_STORAGE) private readonly storage: DocumentStorage,
    @Inject(ENV) private readonly env: Env,
    private readonly audit: AuditService,
  ) {}

  private inFirm<T>(businessId: string, fn: (tx: TxClient) => Promise<T>): Promise<T> {
    return this.database.withScope({ kind: 'business', businessId }, fn);
  }

  async list(businessId: string, q: ListQuery): Promise<LeadList> {
    const after = q.cursor ? decodeCursor(q.cursor) : undefined;
    const term = q.search ? likeEscape(q.search) : undefined;
    const where: Prisma.LeadWhereInput = {
      AND: [
        { businessId, status: q.status ?? { in: REVIEWED } },
        q.serviceId ? { serviceId: q.serviceId } : {},
        term
          ? {
              OR: [
                { firstName: { contains: term, mode: 'insensitive' } },
                { lastName: { contains: term, mode: 'insensitive' } },
                { email: { contains: term, mode: 'insensitive' } },
                { phone: { contains: term, mode: 'insensitive' } },
              ],
            }
          : {},
        after
          ? {
              OR: [
                { submittedAt: { lt: after.createdAt } },
                { submittedAt: after.createdAt, id: { lt: after.id } },
              ],
            }
          : {},
      ],
    };
    const rows = await this.database.forBusiness(businessId).lead.findMany({
      where,
      orderBy: [{ submittedAt: 'desc' }, { id: 'desc' }],
      take: q.limit + 1,
      select: listSelect,
    });
    const page = rows.slice(0, q.limit);
    const last = page.at(-1);
    await this.audit.log('leads.listed', { type: 'lead' }, { count: page.length });
    return {
      items: page.map(toItem),
      nextCursor: rows.length > q.limit && last ? encodeCursor(last) : null,
    };
  }

  async counts(businessId: string): Promise<LeadCounts> {
    const groups = await this.database.forBusiness(businessId).lead.groupBy({
      by: ['status'],
      where: { businessId, status: { in: [...OPEN] } },
      _count: { _all: true },
    });
    const of = (s: string) => groups.find((g) => g.status === s)?._count._all ?? 0;
    return { submitted: of('SUBMITTED'), inReview: of('IN_REVIEW') };
  }

  async get(businessId: string, id: string): Promise<LeadDetail> {
    const detail = await this.inFirm(businessId, (tx) => this.detail(tx, businessId, id));
    await this.audit.log('lead.viewed', { type: 'lead', id });
    return detail;
  }

  /** SUBMITTED to IN_REVIEW, naming who took it. */
  async startReview(businessId: string, actor: ClientsActor, id: string): Promise<LeadDetail> {
    const detail = await this.inFirm(businessId, async (tx) => {
      const lead = await this.lock(tx, businessId, id);
      if (lead.status !== 'SUBMITTED') throw conflict('INVALID_STATUS', 'Not a new lead');
      await tx.lead.update({
        where: { id },
        data: { status: 'IN_REVIEW', reviewedByUserId: actor.userId, reviewedAt: new Date() },
      });
      return this.detail(tx, businessId, id);
    });
    await this.audit.log('lead.review_started', { type: 'lead', id });
    return detail;
  }

  async decline(
    businessId: string,
    actor: ClientsActor,
    id: string,
    reason: string,
  ): Promise<LeadDetail> {
    const detail = await this.inFirm(businessId, async (tx) => {
      const lead = await this.lock(tx, businessId, id);
      if (!OPEN.includes(lead.status as (typeof OPEN)[number])) throw handled();
      await tx.lead.update({
        where: { id },
        data: {
          status: 'DECLINED',
          declineReason: reason,
          reviewedByUserId: actor.userId,
          reviewedAt: new Date(),
        },
      });
      return this.detail(tx, businessId, id);
    });
    // The reason stays out of the audit metadata too: it is free text about a person.
    await this.audit.log('lead.declined', { type: 'lead', id });
    return detail;
  }

  async convert(
    businessId: string,
    actor: ClientsActor,
    id: string,
    body: ConvertBody,
  ): Promise<ConvertLeadResponse> {
    if (actor.role === 'STAFF' && body.assignedUserId && body.assignedUserId !== actor.userId) {
      throw new ForbiddenException({ code: 'FORBIDDEN', message: 'This action is not permitted' });
    }
    const assignedUserId = actor.role === 'STAFF' ? actor.userId : (body.assignedUserId ?? null);
    const result = await this.inFirm(businessId, async (tx) => {
      const lead = await this.lock(tx, businessId, id);
      if (!OPEN.includes(lead.status as (typeof OPEN)[number])) throw handled();
      if (assignedUserId && !body.clientId) await this.activeMember(tx, businessId, assignedUserId);
      const clientId = body.clientId
        ? await this.existingClient(tx, businessId, actor, body.clientId)
        : await this.newClient(tx, businessId, lead, body, assignedUserId);
      const service = await tx.service.findUniqueOrThrow({
        where: { businessId_id: { businessId, id: lead.serviceId } },
        select: { name: true, billingInterval: true },
      });
      const engagement = await tx.engagement.create({
        data: {
          businessId,
          clientId,
          serviceId: lead.serviceId,
          title: body.title ?? (lead.taxYear ? `${service.name} ${lead.taxYear}` : service.name),
          taxYear: lead.taxYear,
          status: 'ACTIVE',
          billingInterval: service.billingInterval,
          assignedUserId,
          updatedByUserId: actor.userId,
        },
        select: { id: true },
      });
      await tx.lead.update({
        where: { id },
        data: {
          status: 'CONVERTED',
          clientId,
          engagementId: engagement.id,
          reviewedByUserId: actor.userId,
          reviewedAt: new Date(),
        },
      });
      const intake = await tx.intake.findFirst({
        where: { businessId, leadId: id },
        orderBy: { createdAt: 'asc' },
        select: { id: true },
      });
      if (intake) {
        await tx.intake.update({ where: { id: intake.id }, data: { engagementId: engagement.id } });
      }
      const carried = await this.carryUploads(tx, businessId, id, {
        clientId,
        engagementId: engagement.id,
        intakeId: intake?.id ?? null,
        taxYear: lead.taxYear,
      });
      const firm = await tx.business.findUniqueOrThrow({
        where: { id: businessId },
        select: { slug: true },
      });
      return {
        clientId,
        engagementId: engagement.id,
        carried,
        invite: { name: `${lead.firstName} ${lead.lastName}`, email: lead.email, slug: firm.slug },
        detail: await this.detail(tx, businessId, id),
      };
    });
    await this.audit.log(
      'lead.converted',
      { type: 'lead', id },
      {
        clientId: result.clientId,
        engagementId: result.engagementId,
        newClient: !body.clientId,
        documents: result.carried,
      },
    );
    // Only a new client is invited: an existing one already has (or was offered) a login.
    const inviteSent =
      body.sendPortalInvite && !body.clientId
        ? await this.invite(businessId, result.invite)
        : false;
    return {
      lead: result.detail,
      clientId: result.clientId,
      engagementId: result.engagementId,
      inviteSent,
    };
  }

  /** A 5-minute link to one CLEAN upload of a lead the firm sees. */
  async downloadUpload(businessId: string, id: string, uploadId: string): Promise<DownloadLink> {
    const file = await this.database.forBusiness(businessId).leadUpload.findFirst({
      where: { businessId, id: uploadId, lead: { id, status: { in: REVIEWED } } },
      select: {
        id: true,
        s3Key: true,
        fileName: true,
        contentType: true,
        sizeBytes: true,
        sha256: true,
        scanStatus: true,
      },
    });
    if (!file) throw notFound();
    const unavailable = () => conflict('FILE_NOT_AVAILABLE', 'This file is not available');
    if (file.scanStatus !== 'CLEAN') throw unavailable();
    const stored = await this.storage.head(file.s3Key, { checksum: true });
    if (
      stored?.sizeBytes !== file.sizeBytes ||
      stored.sha256 !== file.sha256 ||
      stored.contentEncoding !== null
    ) {
      this.logger.warn(`Lead upload ${file.id}: the stored file is not the confirmed one`); // ids only
      throw unavailable();
    }
    const url = await this.storage.presignDownload({
      key: file.s3Key,
      fileName: file.fileName,
      contentType: file.contentType,
    });
    const expiresAt = new Date(Date.now() + 300_000).toISOString();
    await this.audit.log(
      'lead_upload.download_link_issued',
      { type: 'lead_upload', id: file.id },
      { leadId: id, expiresAt },
    );
    return { url, expiresAt };
  }

  /** The lead, held for this transaction; 404 for a draft, an expired draft or another firm's. */
  private async lock(tx: TxClient, businessId: string, id: string) {
    const rows = await tx.$queryRaw<
      { id: string; status: string; service_id: string }[]
    >`SELECT id, status::text, service_id FROM leads WHERE business_id = ${businessId}::uuid AND id = ${id}::uuid FOR UPDATE`;
    const row = rows[0];
    if (!row || !REVIEWED.includes(row.status as ReviewedLeadStatus)) throw notFound();
    return tx.lead.findUniqueOrThrow({
      where: { id },
      select: {
        status: true,
        serviceId: true,
        firstName: true,
        lastName: true,
        email: true,
        phone: true,
        taxYear: true,
      },
    });
  }

  private async detail(tx: TxClient, businessId: string, id: string): Promise<LeadDetail> {
    const row = await tx.lead.findFirst({
      where: { businessId, id, status: { in: REVIEWED } },
      select: detailSelect,
    });
    if (!row) throw notFound();
    const reviewer = row.reviewedByUserId
      ? await tx.membership.findFirst({
          where: { businessId, userId: row.reviewedByUserId },
          select: { userId: true, user: { select: { name: true } } },
        })
      : null;
    return {
      ...toItem(row),
      intake: await this.intakeOf(row),
      reviewedAt: iso(row.reviewedAt),
      reviewedBy: reviewer ? { userId: reviewer.userId, name: reviewer.user.name } : null,
      declineReason: row.declineReason,
      client: row.engagement?.client ?? null,
      engagementId: row.engagementId,
    };
  }

  private async intakeOf(row: DetailRow): Promise<LeadDetail['intake']> {
    const intake = row.intakes[0];
    if (!intake) return null;
    const definition = IntakeFormDefinition.parse(intake.form.definition);
    const stored = (intake.submissions[0]?.answers ?? {}) as Record<string, unknown>;
    return {
      id: intake.id,
      status: intake.status,
      formVersion: intake.form.version,
      definition,
      answers: await maskStoredNumbers(definition, stored),
      uploads: row.uploads.map((u) => ({ ...u, createdAt: u.createdAt.toISOString() })),
    };
  }

  private async activeMember(tx: TxClient, businessId: string, userId: string): Promise<void> {
    const member = await tx.membership.findFirst({
      where: { businessId, userId, status: 'ACTIVE' },
      select: { userId: true },
    });
    if (!member) throw notFound();
  }

  /** A client the member reaches (Staff: their own), not archived. */
  private async existingClient(
    tx: TxClient,
    businessId: string,
    actor: ClientsActor,
    clientId: string,
  ): Promise<string> {
    const client = await tx.client.findFirst({
      where: {
        businessId,
        id: clientId,
        ...(actor.role === 'STAFF' ? { assignedUserId: actor.userId } : {}),
      },
      select: { id: true, archivedAt: true },
    });
    if (!client) throw notFound();
    if (client.archivedAt) throw conflict('CLIENT_ARCHIVED', 'Restore the client first');
    return client.id;
  }

  /** The new client from the lead's contact, as R10's create makes one (empty profile). */
  private async newClient(
    tx: TxClient,
    businessId: string,
    lead: { firstName: string; lastName: string; email: string; phone: string | null },
    body: ConvertBody,
    assignedUserId: string | null,
  ): Promise<string> {
    await lockClientEmails(tx, businessId);
    const taken = await tx.client.findFirst({
      where: { businessId, email: lead.email },
      select: { id: true },
    });
    if (taken) throw conflict('DUPLICATE_EMAIL', 'Another client has this email');
    const client = await tx.client.create({
      data: {
        businessId,
        accountType: body.accountType ?? 'INDIVIDUAL',
        displayName: `${lead.firstName} ${lead.lastName}`,
        email: lead.email,
        phone: lead.phone,
        assignedUserId,
      },
      select: { id: true },
    });
    await tx.clientProfile.create({ data: { businessId, clientId: client.id } });
    return client.id;
  }

  /** Each upload becomes a document of the new engagement with the same S3 key and scan result. */
  private async carryUploads(
    tx: TxClient,
    businessId: string,
    leadId: string,
    to: { clientId: string; engagementId: string; intakeId: string | null; taxYear: number | null },
  ): Promise<number> {
    const uploads = await tx.leadUpload.findMany({
      where: { businessId, leadId },
      select: {
        id: true,
        slot: true,
        fileName: true,
        contentType: true,
        sizeBytes: true,
        sha256: true,
        s3Key: true,
        scanStatus: true,
        scannedAt: true,
      },
    });
    for (const u of uploads) {
      await tx.document.create({
        data: {
          businessId,
          clientId: to.clientId,
          engagementId: to.engagementId,
          leadUploadId: u.id,
          intakeId: to.intakeId,
          intakeSlot: to.intakeId ? u.slot : null,
          direction: 'CLIENT_TO_FIRM',
          fileName: u.fileName,
          contentType: u.contentType,
          sizeBytes: u.sizeBytes,
          sha256: u.sha256,
          s3Key: u.s3Key,
          scanStatus: u.scanStatus,
          scannedAt: u.scannedAt,
          taxYear: to.taxYear,
        },
      });
    }
    return uploads.length;
  }

  /** The portal invitation; a failed email never undoes the conversion. */
  private async invite(
    businessId: string,
    to: { name: string; email: string; slug: string },
  ): Promise<boolean> {
    try {
      await this.notify.send({
        template: 'client.portal-invite',
        to: to.email,
        businessId,
        data: {
          name: to.name,
          signUpLink: `${this.env.PORTAL_BASE_URL.replace(/\/+$/, '')}/${to.slug}/sign-up`,
        },
      });
      return true;
    } catch (error) {
      if (!(error instanceof NotifyDeliveryError)) throw error;
      this.logger.warn(`Lead conversion in ${businessId}: the portal invitation was not sent`);
      return false;
    }
  }
}
