import {
  ConflictException,
  ForbiddenException,
  HttpException,
  Inject,
  Injectable,
  Logger,
} from '@nestjs/common';
import type { Database, TxClient } from '@firmivra/db';
import type {
  ConvertLeadRequest,
  ConvertLeadResponse,
  ConvertLeadToClientRequest,
  ConvertLeadToClientResult,
  DownloadLink,
} from '@firmivra/types';
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
import { invalid, lockLead, requireActiveMember } from './pipeline.shared.js';

type ConvertBody = z.output<typeof ConvertLeadRequest>;
type ToClientBody = z.output<typeof ConvertLeadToClientRequest>;
/** What a CONVERTED activity keeps so a retry with the same key gets the first answer. */
interface Stored {
  result: Omit<ConvertLeadToClientResult, 'inviteSent'> & { inviteSent: boolean };
}

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

  /**
   * Convert Lead to Client (R57, five steps in one call): the client (or `clientId`), one ACTIVE
   * engagement per service, the chosen history carried over, the lead kept as CONVERTED and linked.
   * One transaction; the portal invitation goes out after it commits. Retry-safe: the key is kept
   * in the CONVERTED activity's metadata, and a repeat with it returns the first result (with
   * `inviteSent` false: an invitation is never sent twice).
   */
  async convertToClient(
    businessId: string,
    actor: ClientsActor,
    id: string,
    body: ToClientBody,
  ): Promise<ConvertLeadToClientResult> {
    if (actor.role === 'STAFF' && body.primaryStaffUserId !== actor.userId) {
      throw new ForbiddenException({ code: 'FORBIDDEN', message: 'This action is not permitted' });
    }
    if (body.address && body.address.length > 200) throw invalid('Use at most 200 characters');
    const serviceIds = [...new Set(body.serviceIds)];
    const email = body.email.toLowerCase();
    const result = await this.inFirm(businessId, async (tx) => {
      const lead = await lockLead(tx, businessId, actor, id);
      if (lead.archivedAt) throw notFound();
      if (lead.status === 'CONVERTED') {
        const first = await tx.leadActivity.findFirst({
          where: {
            businessId,
            leadId: id,
            kind: 'CONVERTED',
            metadata: { path: ['idempotencyKey'], equals: body.idempotencyKey },
          },
          select: { metadata: true },
        });
        if (!first) throw conflict('ALREADY_CONVERTED', 'This lead is already a client');
        const m = first.metadata as unknown as Stored;
        return { replay: true as const, out: { ...m.result, inviteSent: false } };
      }
      const services = await tx.service.findMany({
        where: { businessId, archivedAt: null, id: { in: serviceIds } },
        select: { id: true, name: true, billingInterval: true },
      });
      if (services.length !== serviceIds.length) throw notFound();
      await requireActiveMember(tx, businessId, body.primaryStaffUserId);
      for (const userId of body.additionalStaffUserIds) {
        await requireActiveMember(tx, businessId, userId);
      }
      // leads_rules: the lead's engagement is for the lead's own service, which never changes.
      if (!serviceIds.includes(lead.serviceId)) {
        throw conflict(
          'LEAD_SERVICE_REQUIRED',
          "The lead's own service must be one of the services",
        );
      }
      const carry = body.carryOver;
      const clientId = body.clientId
        ? await this.existingClient(tx, businessId, actor, body.clientId)
        : await this.createClient(tx, businessId, actor, lead, body, email);
      const engagementIds: string[] = [];
      const engagementOf = new Map<string, string>();
      for (const serviceId of serviceIds) {
        const service = services.find((s) => s.id === serviceId)!;
        const year = serviceId === lead.serviceId ? lead.taxYear : null;
        const engagement = await tx.engagement.create({
          data: {
            businessId,
            clientId,
            serviceId,
            title: year ? `${service.name} ${year}` : service.name,
            taxYear: year,
            status: 'ACTIVE',
            billingInterval: service.billingInterval,
            assignedUserId: body.primaryStaffUserId,
            updatedByUserId: actor.userId,
          },
          select: { id: true },
        });
        engagementIds.push(engagement.id);
        engagementOf.set(serviceId, engagement.id);
      }
      await tx.lead.update({
        where: { id },
        data: {
          status: 'CONVERTED',
          clientId,
          engagementId: engagementOf.get(lead.serviceId)!,
          reviewedByUserId: actor.userId,
          reviewedAt: new Date(),
          nextActionType: null,
          nextActionAt: null,
          nextActionNote: null,
          updatedByUserId: actor.userId,
        },
      });
      if (carry.tags) {
        const tags = await tx.leadTag.findMany({
          where: { businessId, leadId: id, tag: { archivedAt: null } },
          select: { tagId: true },
        });
        await tx.clientTag.createMany({
          data: tags.map((t) => ({
            businessId,
            clientId,
            tagId: t.tagId,
            addedByUserId: actor.userId,
          })),
          skipDuplicates: true,
        });
      }
      const carried = {
        notes: 0,
        // Appointments, tasks and a client-side communications history have nowhere to go yet.
        communications: 0,
        appointments: 0,
        tasks: 0,
        documents: 0,
        intakeForms: 0,
      };
      if (carry.notes) {
        const notes = await tx.leadActivity.findMany({
          where: { businessId, leadId: id, kind: 'NOTE' },
          orderBy: [{ occurredAt: 'asc' }, { id: 'asc' }],
          select: { body: true, actorUserId: true, occurredAt: true },
        });
        for (const n of notes) {
          await tx.note.create({
            data: {
              businessId,
              clientId,
              body: n.body ?? '',
              authorUserId: n.actorUserId ?? actor.userId,
              createdAt: n.occurredAt,
            },
          });
        }
        carried.notes = notes.length;
      }
      const intakes = await tx.intake.findMany({
        where: { businessId, leadId: id },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        select: { id: true, form: { select: { serviceId: true } } },
      });
      // An intake joins the engagement of its form's service, else the first one.
      let firstIntake: { id: string; engagementId: string } | null = null;
      if (carry.intakeForms) {
        for (const i of intakes) {
          const engagementId = engagementOf.get(i.form.serviceId) ?? engagementIds[0]!;
          await tx.intake.update({ where: { id: i.id }, data: { engagementId } });
          firstIntake ??= { id: i.id, engagementId };
        }
        carried.intakeForms = intakes.length;
      }
      if (carry.documents) {
        carried.documents = await this.carryUploads(tx, businessId, id, {
          clientId,
          engagementId: firstIntake?.engagementId ?? engagementIds[0]!,
          intakeId: firstIntake?.id ?? null,
          taxYear: lead.taxYear,
        });
      }
      const out = { clientId, engagementIds, inviteSent: false, carried };
      await tx.leadActivity.create({
        data: {
          businessId,
          leadId: id,
          kind: 'CONVERTED',
          actorUserId: actor.userId,
          metadata: { idempotencyKey: body.idempotencyKey, result: out },
        },
      });
      return {
        replay: false as const,
        out,
        newClient: !body.clientId,
        invite: { name: body.fullName, email, slug: await this.slugOf(tx, businessId) },
      };
    });
    if (result.replay) return result.out;
    const { out } = result;
    if (result.newClient) {
      await this.audit.log(
        'client.created',
        { type: 'client', id: out.clientId },
        { from: 'lead', leadId: id },
      );
    }
    for (const engagementId of out.engagementIds) {
      await this.audit.log(
        'engagement.created',
        { type: 'engagement', id: engagementId },
        { clientId: out.clientId, from: 'lead', leadId: id },
      );
    }
    await this.audit.log(
      'lead.converted',
      { type: 'lead', id },
      {
        clientId: out.clientId,
        engagementIds: out.engagementIds,
        newClient: result.newClient,
        carried: out.carried,
      },
    );
    const inviteSent =
      body.sendPortalInvite && result.newClient
        ? await this.invite(businessId, result.invite)
        : false;
    return { ...out, inviteSent };
  }

  private async slugOf(tx: TxClient, businessId: string): Promise<string> {
    const firm = await tx.business.findUniqueOrThrow({
      where: { id: businessId },
      select: { slug: true },
    });
    return firm.slug;
  }

  /** The client from the Convert form's own fields (the member may have changed the lead's). */
  private async createClient(
    tx: TxClient,
    businessId: string,
    actor: ClientsActor,
    lead: { source: string; sourceDetail?: string | null },
    body: ToClientBody,
    email: string,
  ): Promise<string> {
    await lockClientEmails(tx, businessId);
    const taken = await tx.client.findFirst({ where: { businessId, email }, select: { id: true } });
    if (taken) {
      throw new ConflictException({
        code: 'DUPLICATE_EMAIL',
        message: 'Another client has this email',
        // Only the people who reach every client are told which one.
        ...(actor.role === 'STAFF' ? {} : { details: { clientId: taken.id } }),
      });
    }
    const contact = body.carryOver.contactInfo;
    const business = body.accountType === 'BUSINESS' && body.businessName;
    const space = body.fullName.lastIndexOf(' ');
    const client = await tx.client.create({
      data: {
        businessId,
        accountType: body.accountType,
        displayName: business || body.fullName,
        email,
        phone: contact ? body.phone : null,
        assignedUserId: body.primaryStaffUserId,
        source: body.carryOver.attribution ? lead.source : null,
        sourceDetail: body.carryOver.attribution ? (lead.sourceDetail ?? null) : null,
        updatedByUserId: actor.userId,
      },
      select: { id: true },
    });
    await tx.clientProfile.create({
      data: {
        businessId,
        clientId: client.id,
        firstName: space > 0 ? body.fullName.slice(0, space) : body.fullName,
        lastName: space > 0 ? body.fullName.slice(space + 1) : null,
        businessName: body.businessName ?? null,
        addressLine1: contact ? (body.address ?? null) : null,
      },
    });
    return client.id;
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
