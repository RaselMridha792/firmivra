import { createHash, randomUUID } from 'node:crypto';
import { HttpException, Inject, Injectable, Logger } from '@nestjs/common';
import type { z } from 'zod';
import type {
  DuplicateEsignTemplateBody,
  EsignTemplateDetail,
  EsignTemplateField,
  EsignTemplateRole,
  SaveEsignTemplateBody,
} from '@firmivra/types';
import { AuditService } from '../../audit/audit.service.js';
import {
  ESIGN_STORE,
  EsignEngineError,
  type EsignStore,
  PDF_ENGINE,
  type PdfEngine,
} from '../engine/engine.types.js';
import {
  ESIGN_REPOSITORY,
  type EsignRepository,
  type EsignRequestRecord,
} from '../requests/esign.repository.js';
import {
  type EsignActor,
  EsignRequestsService,
  esignRefusal,
} from '../requests/requests.service.js';
import {
  type EsignTemplateContent,
  type EsignTemplateRepository,
  type EsignTemplateVersionRecord,
  type NewEsignTemplate,
  TEMPLATE_REPOSITORY,
} from './templates.repository.js';
import { EsignTemplatesService, forbidden, templateEntity } from './templates.service.js';

type Store = Pick<EsignStore, 'keyFor' | 'read' | 'put' | 'remove'>;
const sha256 = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
const errorName = (error: unknown) => (error instanceof Error ? error.name : typeof error);

/**
 * Templates from requests (R13 step 9): save-as-template and duplicate. A template takes nothing
 * of one client (SaveEsignTemplateBody): the packet as one PDF in the template's own folder, the
 * recipients as roles, the fields without merge or signer values (and without the sender's own
 * unless asked) and the settings. A refused write removes the packet it stored.
 */
@Injectable()
export class EsignTemplateCopyService {
  private readonly logger = new Logger(EsignTemplateCopyService.name);

  constructor(
    @Inject(EsignRequestsService) private readonly requests: EsignRequestsService,
    @Inject(EsignTemplatesService) private readonly templateAccess: EsignTemplatesService,
    @Inject(TEMPLATE_REPOSITORY) private readonly templates: EsignTemplateRepository,
    @Inject(ESIGN_REPOSITORY) private readonly repo: EsignRepository,
    @Inject(PDF_ENGINE) private readonly pdf: Pick<PdfEngine, 'compose'>,
    @Inject(ESIGN_STORE) private readonly store: Store,
    @Inject(AuditService) private readonly audit: Pick<AuditService, 'log'>,
  ) {}

  /** A new template the caller owns. 409 TEMPLATE_HAS_CLIENT_FILES, TEMPLATE_NAME_TAKEN. */
  async saveAsTemplate(
    businessId: string,
    actor: EsignActor,
    requestId: string,
    body: z.output<typeof SaveEsignTemplateBody>,
  ): Promise<EsignTemplateDetail> {
    const { record } = await this.requests.reach(businessId, actor, requestId, 'write');
    const id = randomUUID();
    const content = await this.snapshot(businessId, record, id, body.keepSenderValues);
    const { name, visibility } = body;
    const template = { id, name, description: body.description ?? null, visibility };
    return this.created(businessId, actor, content, template, { fromRequestId: requestId });
  }

  /** A copy of the newest version the caller owns, at version 1. 409 TEMPLATE_NAME_TAKEN. */
  async duplicate(
    businessId: string,
    actor: EsignActor,
    templateId: string,
    body: z.output<typeof DuplicateEsignTemplateBody>,
  ): Promise<EsignTemplateDetail> {
    const source = await this.templateAccess.reach(businessId, actor, templateId);
    if (actor.role === 'VIEWER') throw forbidden();
    const current = await this.templateAccess.current(businessId, source);
    const id = randomUUID();
    const s3Key = this.store.keyFor(businessId, id, `template-${randomUUID()}.pdf`);
    await this.store.put(
      businessId,
      s3Key,
      await this.packet(businessId, current),
      'application/pdf',
    );
    const content = { ...current, s3Key };
    const visibility = body.visibility ?? source.visibility;
    const template = { id, name: body.name, description: source.description, visibility };
    return this.created(businessId, actor, content, template, { fromTemplateId: templateId });
  }

  /**
   * What a template keeps of a request (SaveEsignTemplateBody), its packet stored in the
   * template's folder: 409 FILE_BLOCKED, SCAN_PENDING, TEMPLATE_HAS_CLIENT_FILES, and
   * INVALID_STATE with no pages, before anything is stored.
   */
  async snapshot(
    businessId: string,
    record: EsignRequestRecord,
    templateId: string,
    keepSenderValues: boolean,
  ): Promise<EsignTemplateContent> {
    const parts = await this.repo.parts(businessId, record.id);
    const { documents } = parts;
    if (documents.some((d) => d.scanStatus === 'INFECTED' || d.scanStatus === 'FAILED')) {
      throw esignRefusal('FILE_BLOCKED');
    }
    if (documents.some((d) => d.scanStatus !== 'CLEAN')) throw esignRefusal('SCAN_PENDING');
    if (documents.some((d) => d.sourceDocumentId !== null)) {
      throw esignRefusal('TEMPLATE_HAS_CLIENT_FILES');
    }
    if (parts.pagePlan.length === 0) throw esignRefusal('INVALID_STATE');
    const files = await Promise.all(
      documents.map(async (d) => {
        const bytes = await this.store.read(businessId, d.s3Key);
        if (!bytes) throw new Error(`esign document ${d.id} is missing from the store`);
        return { documentId: d.id, contentType: d.contentType, bytes };
      }),
    );
    const packet = await this.pdf.compose(files, parts.pagePlan).catch((error: unknown) => {
      throw error instanceof EsignEngineError ? esignRefusal(error.code) : error;
    });
    const sizes = new Map(documents.map((d) => [d.id, d.pageSizes]));
    const keyOf = new Map(parts.recipients.map((r, i) => [r.id, `role-${i + 1}`]));
    const s3Key = this.store.keyFor(businessId, templateId, `template-${randomUUID()}.pdf`);
    await this.store.put(businessId, s3Key, packet, 'application/pdf');
    return {
      ...settingsOf(record),
      s3Key,
      sha256: sha256(packet),
      sizeBytes: packet.byteLength,
      // Each page as shown: a quarter turn swaps its sides.
      pageSizes: parts.pagePlan.map((p) => {
        const { width, height } = sizes.get(p.documentId)![p.page]!;
        return p.rotation % 180 === 0 ? { width, height } : { width: height, height: width };
      }),
      roles: parts.recipients.map((r): EsignTemplateRole => ({
        key: keyOf.get(r.id)!,
        kind: r.kind,
        role: r.role,
        roleLabel: r.roleLabel,
        routingOrder: r.routingOrder,
        authMethod: r.authMethod,
        colorIndex: r.colorIndex,
      })),
      fields: parts.fields.map(({ recipientId, filled: _filled, ...f }): EsignTemplateField => {
        const own = keepSenderValues && recipientId === null && f.mergeKey === null;
        return {
          ...f,
          id: randomUUID(),
          roleKey: recipientId && (keyOf.get(recipientId) ?? null),
          value: own ? f.value : null,
        };
      }),
    };
  }

  /** Inserts the template (version 1 by the caller) and answers it, 201. */
  private async created(
    businessId: string,
    actor: EsignActor,
    content: EsignTemplateContent,
    template: Omit<NewEsignTemplate, 'ownerUserId'>,
    from: { fromRequestId: string } | { fromTemplateId: string },
  ): Promise<EsignTemplateDetail> {
    const record = await this.removingOnFailure(businessId, content.s3Key, async () => {
      const written = await this.templates.create(
        businessId,
        { ...template, ownerUserId: actor.userId },
        { ...content, note: null },
      );
      if (written === 'NAME_TAKEN') throw esignRefusal('TEMPLATE_NAME_TAKEN');
      return written;
    });
    await this.audit.log('esign.template_created', templateEntity(record.id), {
      ...from,
      visibility: record.visibility,
      version: record.version,
    });
    return this.templateAccess.detail(businessId, actor, record);
  }

  /** The version's packet, which must be the bytes it saved (409 FILE_BLOCKED otherwise). */
  async packet(businessId: string, v: EsignTemplateVersionRecord): Promise<Uint8Array> {
    const bytes = await this.store.read(businessId, v.s3Key);
    if (!bytes || sha256(bytes) !== v.sha256) throw esignRefusal('FILE_BLOCKED');
    return bytes;
  }

  /** A copy of the version's packet under a new key in the template's folder. */
  async copyPacket(
    businessId: string,
    templateId: string,
    v: EsignTemplateVersionRecord,
  ): Promise<string> {
    const s3Key = this.store.keyFor(businessId, templateId, `template-${randomUUID()}.pdf`);
    await this.store.put(businessId, s3Key, await this.packet(businessId, v), 'application/pdf');
    return s3Key;
  }

  /** Runs `work`; if it throws, the object stored for it is removed first. */
  async removingOnFailure<T>(businessId: string, key: string, work: () => Promise<T>) {
    try {
      return await work();
    } catch (error) {
      await this.store.remove(businessId, key).catch((e: unknown) => {
        this.logger.warn(`Could not remove an unused esign template file: ${errorName(e)}`);
      });
      if (!(error instanceof HttpException)) {
        this.logger.error(`Esign template write failed: ${errorName(error)}`);
      }
      throw error;
    }
  }
}

/** The settings a request and a template share. */
export function settingsOf(
  x: Pick<
    EsignTemplateContent,
    'routing' | 'expiryDays' | 'reminders' | 'expiryWarningDays' | 'emailSubject' | 'emailMessage'
  >,
) {
  const { routing, expiryDays, reminders, expiryWarningDays, emailSubject, emailMessage } = x;
  return { routing, expiryDays, reminders, expiryWarningDays, emailSubject, emailMessage };
}
