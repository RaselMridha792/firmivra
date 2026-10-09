import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import type { z } from 'zod';
import type {
  EsignTemplateDetail,
  EsignTemplateVersionList,
  RestoreEsignTemplateVersionBody,
  SaveEsignTemplateVersionBody,
} from '@firmivra/types';
import { AuditService } from '../../audit/audit.service.js';
import { ESIGN_DIRECTORY, type EsignDirectory } from '../requests/esign-directory.js';
import { type EsignActor, EsignRequestsService } from '../requests/requests.service.js';
import { EsignTemplateCopyService } from './template-copy.service.js';
import { type EsignTemplateRepository, TEMPLATE_REPOSITORY } from './templates.repository.js';
import { EsignTemplatesService, templateEntity, templateSaved } from './templates.service.js';

const NOT_FOUND = { code: 'NOT_FOUND', message: 'Not found' };

/**
 * Template versions (R13 step 10, contract 3): the list, save-as-version and restore. Using a
 * template copies its newest version; saving or restoring adds a version on top and never
 * changes or deletes one. Reading is for anyone who sees the template; adding a version is for
 * whoever may change it (EsignTemplatesService.editable: 403, 409 TEMPLATE_ARCHIVED), and like
 * every template write it is optimistic on updatedAt (409 INVALID_STATE). Audit: ids only.
 */
@Injectable()
export class EsignTemplateVersionsService {
  constructor(
    @Inject(EsignRequestsService) private readonly requests: EsignRequestsService,
    @Inject(EsignTemplatesService) private readonly templateAccess: EsignTemplatesService,
    @Inject(EsignTemplateCopyService) private readonly copies: EsignTemplateCopyService,
    @Inject(TEMPLATE_REPOSITORY) private readonly templates: EsignTemplateRepository,
    @Inject(ESIGN_DIRECTORY) private readonly directory: EsignDirectory,
    @Inject(AuditService) private readonly audit: Pick<AuditService, 'log'>,
  ) {}

  /** Every saved version, newest first. */
  async list(
    businessId: string,
    actor: EsignActor,
    templateId: string,
  ): Promise<EsignTemplateVersionList> {
    const t = await this.templateAccess.reach(businessId, actor, templateId);
    const versions = await this.templates.versions(businessId, t.id);
    const ids = [...new Set(versions.map((v) => v.savedByUserId))];
    const members = await Promise.all(ids.map((id) => this.directory.member(businessId, id)));
    const names = new Map(ids.map((id, i) => [id, members[i]?.name ?? '']));
    return {
      items: versions.map((v) => ({
        version: v.version,
        savedAt: v.savedAt.toISOString(),
        savedBy: { userId: v.savedByUserId, name: names.get(v.savedByUserId) ?? '' },
        note: v.note,
        pageCount: v.pageSizes.length,
        roleCount: v.roles.length,
        fieldCount: v.fields.length,
        current: v.version === t.version,
      })),
    };
  }

  /**
   * The request becomes the template's next version, copied and refused exactly as
   * save-as-template (409 TEMPLATE_HAS_CLIENT_FILES, SCAN_PENDING, FILE_BLOCKED).
   */
  async saveAsVersion(
    businessId: string,
    actor: EsignActor,
    requestId: string,
    body: z.output<typeof SaveEsignTemplateVersionBody>,
  ): Promise<EsignTemplateDetail> {
    const { record } = await this.requests.reach(businessId, actor, requestId, 'write');
    const t = await this.templateAccess.editable(businessId, actor, body.templateId);
    const content = await this.copies.snapshot(businessId, record, t.id, body.keepSenderValues);
    const saved = await this.copies.removingOnFailure(businessId, content.s3Key, async () => {
      const version = { ...content, note: body.note ?? null, savedByUserId: actor.userId };
      return templateSaved(await this.templates.addVersion(businessId, t.id, version, t.updatedAt));
    });
    await this.audit.log('esign.template_version_saved', templateEntity(t.id), {
      fromRequestId: requestId,
      version: saved.version,
    });
    return this.templateAccess.detail(businessId, actor, saved);
  }

  /** An older version copied into a new newest one (its packet is shared, never copied). */
  async restore(
    businessId: string,
    actor: EsignActor,
    templateId: string,
    version: number,
    body: z.output<typeof RestoreEsignTemplateVersionBody>,
  ): Promise<EsignTemplateDetail> {
    const t = await this.templateAccess.editable(businessId, actor, templateId);
    const old = await this.templates.version(businessId, t.id, version);
    if (!old) throw new NotFoundException(NOT_FOUND);
    const { version: _v, savedAt: _at, savedByUserId: _by, ...content } = old;
    const note = body.note ?? `Restored version ${version}`;
    const restored = { ...content, note, savedByUserId: actor.userId };
    const saved = templateSaved(
      await this.templates.addVersion(businessId, t.id, restored, t.updatedAt),
    );
    await this.audit.log('esign.template_version_restored', templateEntity(t.id), {
      restoredVersion: version,
      version: saved.version,
    });
    return this.templateAccess.detail(businessId, actor, saved);
  }
}
