import { ForbiddenException, HttpException, Inject, Injectable, Logger } from '@nestjs/common';
import type { Database, TxClient } from '@firmivra/db';
import type { ConvertLeadRequest, ConvertLeadResponse, DownloadLink } from '@firmivra/types';
import type { z } from 'zod';
import { AuditService } from '../audit/audit.service.js';
import { lockClientEmails } from '../client-auth/client-records.js';
import type { ClientsActor } from '../clients/clients.service.js';
import { ENV } from '../config/config.module.js';
import type { Env } from '../config/env.js';
import { DATABASE } from '../database/database.module.js';
import { NotifyDeliveryError } from '../notify/notify.service.js';
import { NOTIFY_SERVICE, type NotifyService } from '../notify/notify.types.js';
import { storageUnavailable } from '../storage/document-records.js';
import { DOCUMENT_STORAGE, type DocumentStorage } from '../storage/document-storage.js';
import { conflict, handled, LeadsService, notFound, OPEN, REVIEWED } from './leads.service.js';

type ConvertBody = z.output<typeof ConvertLeadRequest>;

/**
 * Converting a lead (R11 step 4): makes the client (or uses one the member reaches), an ACTIVE
 * engagement for the lead's service, gives the intake its engagement and carries each upload over
 * as a document with the same S3 key, all in one transaction; the portal invitation goes out
 * after it commits. Also the firm's download links for a lead's uploads.
 */
@Injectable()
export class LeadConvertService {
  private readonly logger = new Logger(LeadConvertService.name);

  constructor(
    @Inject(DATABASE) private readonly database: Database,
    @Inject(NOTIFY_SERVICE) private readonly notify: NotifyService,
    @Inject(DOCUMENT_STORAGE) private readonly storage: DocumentStorage,
    @Inject(ENV) private readonly env: Env,
    private readonly audit: AuditService,
    private readonly leads: LeadsService,
  ) {}

  private inFirm<T>(businessId: string, fn: (tx: TxClient) => Promise<T>): Promise<T> {
    return this.database.withScope({ kind: 'business', businessId }, fn);
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
      const lead = await this.leads.lock(tx, businessId, id);
      if (!OPEN.includes(lead.status as (typeof OPEN)[number])) throw handled();
      // Checked whether the client is new or existing: an unknown, deactivated or other firm's
      // user is 404, never the engagement's assignee.
      if (assignedUserId) await this.activeMember(tx, businessId, assignedUserId);
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
        detail: await this.leads.detail(tx, businessId, id),
      };
    });
    // The new client's and the engagement's own trails start here too (as R10's and R12's creates).
    if (!body.clientId) {
      await this.audit.log(
        'client.created',
        { type: 'client', id: result.clientId },
        { from: 'lead', leadId: id },
      );
    }
    await this.audit.log(
      'engagement.created',
      { type: 'engagement', id: result.engagementId },
      { clientId: result.clientId, from: 'lead', leadId: id },
    );
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
    const stored = await this.s3('HEAD', () => this.storage.head(file.s3Key, { checksum: true }));
    if (
      stored?.sizeBytes !== file.sizeBytes ||
      stored.sha256 !== file.sha256 ||
      stored.contentEncoding !== null
    ) {
      this.logger.warn(`Lead upload ${file.id}: the stored file is not the confirmed one`); // ids only
      throw unavailable();
    }
    const url = await this.s3('presign GET', () =>
      this.storage.presignDownload({
        key: file.s3Key,
        fileName: file.fileName,
        contentType: file.contentType,
      }),
    );
    const expiresAt = new Date(Date.now() + 300_000).toISOString();
    await this.audit.log(
      'lead_upload.download_link_issued',
      { type: 'lead_upload', id: file.id },
      { leadId: id, expiresAt },
    );
    return { url, expiresAt };
  }

  /**
   * A storage call: a failure (no store, a timeout, S3 busy) is 503 SERVICE_UNAVAILABLE with
   * Retry-After, as for documents. The log names the operation and the error's name only.
   */
  private async s3<T>(operation: string, call: () => Promise<T>): Promise<T> {
    try {
      return await call();
    } catch (error) {
      if (error instanceof HttpException) throw error;
      const name = error instanceof Error ? error.name : typeof error;
      this.logger.warn(`Storage ${operation} failed: ${name}; 503`);
      throw storageUnavailable();
    }
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
