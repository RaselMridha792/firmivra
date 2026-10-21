import { createHash, randomUUID } from 'node:crypto';
import {
  BadGatewayException,
  BadRequestException,
  ConflictException,
  GoneException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import type { TxClient } from '@firmivra/db';
import {
  fileNameFitsType,
  type CommunicationAttachment,
  type MessageTemplateDetail,
  type OkResponse,
  type UploadContentType,
  type UploadTicket,
} from '@firmivra/types';
import { z } from 'zod';
import { AuditService } from '../audit/audit.service.js';
import { type PoolSecrets, Sealer } from '../auth/sealed.js';
import { legacyFirmRole, type TenantContext } from '../common/request-context.js';
import {
  DOCUMENT_STORAGE,
  type DocumentStorage,
  onlyPut,
  PUT_URL_SECONDS,
} from '../storage/document-storage.js';
import { readBudget } from '../storage/read-budget.js';
import { checkFile } from '../storage/file-checks.js';
import { TemplateReadService } from '../templates/template-read.service.js';
import { TemplatesService } from '../templates/templates.service.js';
import { BUILT_IN_FIELDS, fill } from '../templates/merge-fields.js';
import { comErrors } from './communications.common.js';
import { e164, type Person } from './communications-audience.service.js';
import type {
  ConfirmUploadBody,
  SaveAsTemplateBody,
  StartAttachmentBody,
  TestSendBody,
} from './communications-input.js';
import {
  CommunicationProviders,
  DeliveryError,
  type DeliveryMessage,
} from './communications-provider.js';
import { type SegCtx, CommunicationSegmentsService } from './communications-segments.service.js';
import { CommunicationsService } from './communications.service.js';

type Out<S extends z.ZodType> = z.output<S>;

/** HKDF label for communication attachment tokens: a token opens only here. */
export const COMMUNICATION_UPLOAD_LABEL = 'fv-communication-upload-v1';
export const COMMUNICATION_UPLOAD_SECONDS = 900;
export const MAX_COMMUNICATION_ATTACHMENTS = 10;

const Claim = z.object({
  pool: z.literal('STAFF'),
  businessId: z.uuid(),
  userId: z.uuid(),
  communicationId: z.uuid(),
  /** tenant/{businessId}/communications/{uuid}, chosen by the API. */
  key: z.string(),
  fileName: z.string(),
  contentType: z.string(),
  sizeBytes: z.number().int().positive(),
  sha256: z.string().regex(/^[0-9a-f]{64}$/),
});
type Claim = z.infer<typeof Claim>;

export class CommunicationUploadTokens extends Sealer<Claim> {
  constructor(secrets: PoolSecrets) {
    super(COMMUNICATION_UPLOAD_LABEL, Claim as never, secrets);
  }
}

interface StoredAttachment {
  id: string;
  fileName: string;
  contentType: string;
  sizeBytes: number;
  s3Key: string;
}

const expired = () =>
  new GoneException({ code: 'UPLOAD_EXPIRED', message: 'This upload has expired' });
const refused = (code: string) =>
  new ConflictException({ code, message: 'The file can’t be used' });
const unavailable = () =>
  new ServiceUnavailableException({
    code: 'SERVICE_UNAVAILABLE',
    message: 'File storage is busy. Try again in a moment.',
    retryAfter: 5,
  });

/** Test sends, saving a draft as a template, and the files that go with an email or announcement. */
@Injectable()
export class CommunicationExtrasService {
  private readonly logger = new Logger(CommunicationExtrasService.name);

  constructor(
    private readonly segments: CommunicationSegmentsService,
    private readonly campaigns: CommunicationsService,
    private readonly providers: CommunicationProviders,
    private readonly templates: TemplatesService,
    private readonly templateReader: TemplateReadService,
    @Inject(DOCUMENT_STORAGE) private readonly storage: DocumentStorage,
    private readonly tokens: CommunicationUploadTokens,
    private readonly audit: AuditService,
  ) {}

  private run<T>(
    tenant: TenantContext,
    userId: string,
    fn: (ctx: SegCtx) => Promise<T>,
  ): Promise<T> {
    return this.segments.withCtx(tenant, userId, fn);
  }

  // ---------- Test send ----------

  /**
   * A non-production test to the caller's own address or number, marked as a test and never a
   * recipient: nothing is recorded in the results or on a client.
   */
  async testSend(
    tenant: TenantContext,
    userId: string,
    id: string,
    body: Out<typeof TestSendBody>,
  ): Promise<OkResponse> {
    const prepared = await this.run(tenant, userId, async (ctx) => {
      this.campaigns.requireWrite(ctx);
      const c = await this.campaigns.load(ctx, id);
      if (c.channel === 'ANNOUNCEMENT')
        throw comErrors.invalid('channel', 'An announcement has no test send; preview it instead');
      const me = await ctx.tx.user.findUnique({
        where: { id: userId },
        select: { name: true, email: true, phone: true },
      });
      const refuse = (message: string) =>
        new BadRequestException({ code: 'TEST_SEND_REFUSED', message });
      let to: string | null;
      if (c.channel === 'EMAIL') {
        if (body.toEmail && body.toEmail.toLowerCase() !== me?.email.toLowerCase())
          throw refuse('A test goes only to your own address');
        to = me?.email ?? null;
      } else {
        const mine = e164(me?.phone);
        if (body.toPhone && body.toPhone !== mine)
          throw refuse('A test goes only to your own number');
        to = mine;
        if (!to) throw refuse('Add your phone number to your profile first');
      }
      const conn = c.connectionId
        ? await ctx.tx.integrationConnection.findFirst({
            where: { businessId: ctx.businessId, id: c.connectionId },
          })
        : null;
      const adapter = conn ? this.providers.get(conn.provider) : undefined;
      if (!conn || !adapter || !['CONNECTED', 'SYNCING'].includes(conn.status))
        throw new ConflictException({
          code: 'CHANNEL_UNAVAILABLE',
          message: 'Choose a connected sender to send a test',
          details: { route: 'INTEGRATIONS' },
        });
      const [business, custom] = await Promise.all([
        ctx.tx.business.findUnique({ where: { id: ctx.businessId }, select: { name: true } }),
        ctx.tx.customMergeField.findMany({
          where: { businessId: ctx.businessId },
          select: { key: true, label: true, fallback: true },
        }),
      ]);
      const person: Person = {
        kind: 'CLIENT',
        id: userId,
        name: me?.name ?? 'You',
        email: me?.email ?? null,
        phone: me?.phone ?? null,
      };
      const examples = new Map(BUILT_IN_FIELDS.map((f) => [f.key.toLowerCase(), f.example]));
      const values = new Map([
        ...examples,
        ...this.campaigns.valuesFor(person, business?.name ?? '', custom),
      ]);
      const channel = c.channel;
      const message: DeliveryMessage = {
        channel,
        connectionId: conn.id,
        businessId: ctx.businessId,
        to: to as string,
        fromName: c.fromName,
        replyTo: c.replyTo,
        subject: c.subject ? `[Test] ${fill(c.subject, values, 'text').text}` : null,
        body: fill(c.body, values, channel === 'SMS' ? 'text' : 'html').text,
        reference: `test-${randomUUID()}`,
      };
      return { adapter, message, communicationId: c.id };
    });
    try {
      await prepared.adapter.send(prepared.message);
    } catch (error) {
      throw new BadGatewayException({
        code: 'PROVIDER_ERROR',
        message: 'The provider could not send the test',
        ...(error instanceof DeliveryError ? { details: { code: error.code } } : {}),
      });
    }
    await this.audit.log(
      'communication.test_sent',
      { type: 'communication', id: prepared.communicationId },
      { communicationId: prepared.communicationId, channel: prepared.message.channel },
    );
    return { ok: true };
  }

  // ---------- Save as template ----------

  /** A NEW template from the draft's content; an existing template is never changed. */
  saveAsTemplate(
    tenant: TenantContext,
    userId: string,
    id: string,
    body: Out<typeof SaveAsTemplateBody>,
  ): Promise<MessageTemplateDetail> {
    return this.run(tenant, userId, async (ctx) => {
      this.campaigns.requireWrite(ctx);
      const c = await this.campaigns.load(ctx, id);
      const actor = {
        userId: ctx.userId,
        role: legacyFirmRole((ctx.tenant as { role: Parameters<typeof legacyFirmRole>[0] }).role),
      };
      const made = await this.templates.insert(ctx.tx, ctx.businessId, actor, {
        kind: c.channel,
        name: body.name,
        categoryId: body.categoryId ?? null,
        subject: c.channel === 'SMS' ? null : c.subject,
        previewText: c.channel === 'EMAIL' ? c.previewText : null,
        body: c.body,
        status: 'DRAFT',
      });
      await this.audit.logIn(
        ctx.tx,
        'communication.saved_as_template',
        { type: 'communication', id: c.id },
        { communicationId: c.id, templateId: made },
      );
      return this.templateReader.detailIn(ctx.tx, ctx.businessId, actor, made);
    });
  }

  // ---------- Attachments ----------

  private async editableDraft(ctx: SegCtx, id: string) {
    this.campaigns.requireWrite(ctx);
    const c = await this.campaigns.lock(ctx, id);
    this.campaigns.assertEditable(c);
    if (c.channel === 'SMS')
      throw comErrors.invalid('channel', 'A text message cannot carry files');
    return c;
  }

  private stored(json: unknown): StoredAttachment[] {
    return ((json ?? []) as StoredAttachment[]).filter((a) => typeof a.id === 'string');
  }

  async ticket(
    tenant: TenantContext,
    userId: string,
    id: string,
    body: Out<typeof StartAttachmentBody>,
  ): Promise<UploadTicket> {
    if (!fileNameFitsType(body.fileName, body.contentType as UploadContentType))
      throw comErrors.invalid('fileName', 'The file name does not fit its type');
    const businessId = tenant.businessId;
    await this.run(tenant, userId, async (ctx) => {
      const c = await this.editableDraft(ctx, id);
      if (this.stored(c.attachments).length >= MAX_COMMUNICATION_ATTACHMENTS)
        throw comErrors.invalid(
          'fileName',
          `A communication holds at most ${MAX_COMMUNICATION_ATTACHMENTS} files`,
        );
    });
    const key = `tenant/${businessId}/communications/${randomUUID()}`;
    const presigned = await this.s3(() =>
      this.storage.presignUpload({
        key,
        contentType: body.contentType,
        sizeBytes: body.sizeBytes,
        sha256: body.sha256,
      }),
    );
    // A small file (its own limit is at most 10 MB): always one PUT.
    const put = onlyPut(presigned);
    const uploadToken = await this.tokens.seal(
      { pool: 'STAFF', businessId, userId, communicationId: id, key, ...body },
      COMMUNICATION_UPLOAD_SECONDS,
    );
    return {
      uploadToken,
      url: put.url,
      method: 'PUT',
      headers: put.headers,
      expiresAt: new Date(Date.now() + PUT_URL_SECONDS * 1000).toISOString(),
    };
  }

  async confirm(
    tenant: TenantContext,
    userId: string,
    body: Out<typeof ConfirmUploadBody>,
  ): Promise<CommunicationAttachment> {
    const businessId = tenant.businessId;
    const claim = (await this.tokens.open(body.uploadToken, 'STAFF'))?.value;
    if (claim?.businessId !== businessId || claim.userId !== userId) throw expired();
    await this.run(tenant, userId, async (ctx) => {
      const c = await this.editableDraft(ctx, claim.communicationId);
      if (this.stored(c.attachments).some((a) => a.s3Key === claim.key)) throw expired();
    });
    const why = await this.checkStored(claim);
    if (why) {
      await this.storage.remove(claim.key).catch(() => {
        this.logger.warn(`Could not delete a refused communication upload in firm ${businessId}`);
      });
      await this.audit.log(
        'communication_attachment.upload_refused',
        { type: 'communication', id: claim.communicationId },
        { communicationId: claim.communicationId, code: why },
      );
      throw refused(why);
    }
    return this.run(tenant, userId, async (ctx) => {
      const c = await this.editableDraft(ctx, claim.communicationId);
      const list = this.stored(c.attachments);
      if (list.length >= MAX_COMMUNICATION_ATTACHMENTS || list.some((a) => a.s3Key === claim.key))
        throw expired();
      const entry: StoredAttachment = {
        id: randomUUID(),
        fileName: claim.fileName,
        contentType: claim.contentType,
        sizeBytes: claim.sizeBytes,
        s3Key: claim.key,
      };
      await this.write(ctx.tx, businessId, c.id, [...list, entry]);
      await this.audit.logIn(
        ctx.tx,
        'communication_attachment.added',
        { type: 'communication', id: c.id },
        { communicationId: c.id, attachmentId: entry.id },
      );
      return {
        id: entry.id,
        fileName: entry.fileName,
        contentType: entry.contentType,
        sizeBytes: entry.sizeBytes,
      };
    });
  }

  async remove(
    tenant: TenantContext,
    userId: string,
    id: string,
    attachmentId: string,
  ): Promise<OkResponse> {
    const businessId = tenant.businessId;
    const key = await this.run(tenant, userId, async (ctx) => {
      const c = await this.editableDraft(ctx, id);
      const list = this.stored(c.attachments);
      const found = list.find((a) => a.id === attachmentId);
      if (!found) throw new NotFoundException({ code: 'NOT_FOUND', message: 'Not found' });
      await this.write(
        ctx.tx,
        businessId,
        c.id,
        list.filter((a) => a.id !== attachmentId),
      );
      await this.audit.logIn(
        ctx.tx,
        'communication_attachment.removed',
        { type: 'communication', id: c.id },
        { communicationId: c.id, attachmentId },
      );
      return found.s3Key;
    });
    await this.storage.remove(key).catch(() => {
      this.logger.warn(`Could not delete a removed communication attachment in firm ${businessId}`);
    });
    return { ok: true };
  }

  /**
   * The files are changed without touching the row's save time, so the composer's etag stays valid
   * through an upload (the autosave that follows would otherwise be refused as a stale save).
   */
  private async write(tx: TxClient, businessId: string, id: string, list: StoredAttachment[]) {
    await tx.$executeRaw`UPDATE communications SET attachments = ${JSON.stringify(list)}::jsonb
      WHERE business_id = ${businessId}::uuid AND id = ${id}::uuid`;
  }

  /** Holding the file's size of the read budget (read-budget.ts); without room, 503 (nothing deleted). */
  private checkStored(claim: Claim): Promise<string | null> {
    return readBudget.hold(claim.sizeBytes, unavailable, async () => {
      const head = await this.s3(() => this.storage.head(claim.key));
      if (head?.sizeBytes !== claim.sizeBytes || head.contentEncoding !== null)
        return 'UPLOAD_MISMATCH';
      const bytes = await this.s3(() => this.storage.read(claim.key));
      if (bytes?.byteLength !== claim.sizeBytes) return 'UPLOAD_MISMATCH';
      if (createHash('sha256').update(bytes).digest('hex') !== claim.sha256)
        return 'UPLOAD_MISMATCH';
      return checkFile(claim.contentType as UploadContentType, bytes);
    });
  }

  private async s3<T>(call: () => Promise<T>): Promise<T> {
    try {
      return await call();
    } catch (error) {
      this.logger.warn(`Communication attachment storage call failed: ${(error as Error).name}`);
      throw unavailable();
    }
  }
}
