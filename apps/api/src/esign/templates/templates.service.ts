import { createHash } from 'node:crypto';
import { ForbiddenException, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import type { z } from 'zod';
import type {
  EsignTemplateDetail,
  EsignTemplateList,
  EsignTemplateRow,
  ListEsignTemplatesQuery,
  UpdateEsignTemplateBody,
} from '@firmivra/types';
import { AuditService } from '../../audit/audit.service.js';
import { ESIGN_STORE, type EsignStore } from '../engine/engine.types.js';
import { ESIGN_DIRECTORY, type EsignDirectory } from '../requests/esign-directory.js';
import { type EsignActor, esignRefusal, seesAll } from '../requests/requests.service.js';
import {
  type EsignTemplateRecord,
  type EsignTemplateRepository,
  type EsignTemplateVersionRecord,
  TEMPLATE_REPOSITORY,
} from './templates.repository.js';

const notFound = () => new NotFoundException({ code: 'NOT_FOUND', message: 'Not found' });
const forbidden = () =>
  new ForbiddenException({ code: 'FORBIDDEN', message: 'This action is not permitted' });
const sha256 = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
export const templateEntity = (id: string) => ({ type: 'esign_template', id });

/** A template write's result: the template as written, or 409 INVALID_STATE when refused. */
export function templateSaved(record: EsignTemplateRecord | null): EsignTemplateRecord {
  if (!record) throw esignRefusal('INVALID_STATE');
  return record;
}

/**
 * Firm Sign templates (R13 step 9): list, get, rename or change, archive, and the packet for the
 * page viewer. Who sees one: FIRM ones everyone in Firm Sign, PRIVATE ones their owner, and Owner
 * and Admin every one; any other is 404. Who changes one: its owner, Owner, Admin, and a Firm Sign
 * Manager for FIRM ones (403 FORBIDDEN otherwise; a Viewer never). Archived ones change no more
 * (409 TEMPLATE_ARCHIVED). A template holds nothing of a client, so reads are not audited; writes
 * are, with ids only.
 */
@Injectable()
export class EsignTemplatesService {
  private readonly logger = new Logger(EsignTemplatesService.name);

  constructor(
    @Inject(TEMPLATE_REPOSITORY) private readonly templates: EsignTemplateRepository,
    @Inject(ESIGN_DIRECTORY) private readonly directory: EsignDirectory,
    @Inject(ESIGN_STORE) private readonly store: Pick<EsignStore, 'read'>,
    @Inject(AuditService) private readonly audit: Pick<AuditService, 'log'>,
  ) {}

  async list(
    businessId: string,
    actor: EsignActor,
    query: z.output<typeof ListEsignTemplatesQuery>,
  ): Promise<EsignTemplateList> {
    const listed = await this.templates.list(businessId, {
      visibleTo: seesAll(actor) ? null : actor.userId,
      archived: query.archived,
      ...(query.q && { search: query.q }),
    });
    const items = await Promise.all(
      listed.map(({ template, current }) => this.row(businessId, actor, template, current)),
    );
    return { items };
  }

  async get(businessId: string, actor: EsignActor, id: string): Promise<EsignTemplateDetail> {
    return this.detail(businessId, actor, await this.reach(businessId, actor, id));
  }

  /** Only the keys sent change. 409 TEMPLATE_NAME_TAKEN, TEMPLATE_ARCHIVED. */
  async update(
    businessId: string,
    actor: EsignActor,
    id: string,
    body: z.output<typeof UpdateEsignTemplateBody>,
  ): Promise<EsignTemplateDetail> {
    const template = await this.editable(businessId, actor, id);
    const patch = Object.fromEntries(Object.entries(body).filter(([, v]) => v !== undefined));
    const written = await this.templates.update(businessId, id, patch, template.updatedAt);
    if (written === 'NAME_TAKEN') throw esignRefusal('TEMPLATE_NAME_TAKEN');
    const saved = templateSaved(written);
    await this.audit.log('esign.template_updated', templateEntity(id), {
      changed: Object.keys(patch),
    });
    return this.detail(businessId, actor, saved);
  }

  /** It can't be used or changed again; requests made from it keep their copy. */
  async archive(businessId: string, actor: EsignActor, id: string): Promise<EsignTemplateDetail> {
    const template = await this.editable(businessId, actor, id);
    const saved = templateSaved(await this.templates.archive(businessId, id, template.updatedAt));
    await this.audit.log('esign.template_archived', templateEntity(id), {});
    return this.detail(businessId, actor, saved);
  }

  /** The newest version's packet, archived templates' too; the bytes must be the stored hash's. */
  async packet(businessId: string, actor: EsignActor, id: string): Promise<Uint8Array> {
    const current = await this.current(businessId, await this.reach(businessId, actor, id));
    const bytes = await this.store.read(businessId, current.s3Key);
    if (!bytes || sha256(bytes) !== current.sha256) {
      this.logger.warn(`Esign template ${id}: the stored packet is not the saved one`); // ids only
      throw esignRefusal('FILE_BLOCKED');
    }
    return bytes;
  }

  /** The template, if the caller may see it; else 404 (another firm's id included). */
  async reach(businessId: string, actor: EsignActor, id: string): Promise<EsignTemplateRecord> {
    const template = await this.templates.find(businessId, id);
    const sees =
      template &&
      (seesAll(actor) || template.visibility === 'FIRM' || template.ownerUserId === actor.userId);
    if (!sees) throw notFound();
    return template;
  }

  /** One the caller may change: 404 as `reach`, 403 FORBIDDEN, 409 TEMPLATE_ARCHIVED. */
  async editable(businessId: string, actor: EsignActor, id: string): Promise<EsignTemplateRecord> {
    const template = await this.reach(businessId, actor, id);
    if (!mayChange(actor, template)) throw forbidden();
    if (template.archivedAt) throw esignRefusal('TEMPLATE_ARCHIVED');
    return template;
  }

  /** The newest version (always stored with its template). */
  async current(businessId: string, t: EsignTemplateRecord): Promise<EsignTemplateVersionRecord> {
    const current = await this.templates.version(businessId, t.id, t.version);
    if (!current) throw new Error(`esign template ${t.id} has no version ${t.version}`);
    return current;
  }

  /** The template as the contract shows it, from its newest version unless given. */
  async detail(
    businessId: string,
    actor: EsignActor,
    t: EsignTemplateRecord,
    current?: EsignTemplateVersionRecord,
  ): Promise<EsignTemplateDetail> {
    const v = current ?? (await this.current(businessId, t));
    return {
      ...(await this.row(businessId, actor, t, v)),
      packetUrl: `/api/v1/esign/templates/${t.id}/packet`,
      pageSizes: v.pageSizes.map(({ width, height }) => ({ width, height })),
      roles: v.roles,
      fields: v.fields,
      routing: v.routing,
      expiryDays: v.expiryDays,
      reminders: v.reminders,
      expiryWarningDays: v.expiryWarningDays,
      emailSubject: v.emailSubject,
      emailMessage: v.emailMessage,
    };
  }

  private async row(
    businessId: string,
    actor: EsignActor,
    t: EsignTemplateRecord,
    v: EsignTemplateVersionRecord,
  ): Promise<EsignTemplateRow> {
    const owner = await this.directory.member(businessId, t.ownerUserId);
    return {
      id: t.id,
      name: t.name,
      description: t.description,
      visibility: t.visibility,
      owner: { userId: t.ownerUserId, name: owner?.name ?? '' },
      pageCount: v.pageSizes.length,
      roleCount: v.roles.length,
      version: t.version,
      updatedAt: t.updatedAt.toISOString(),
      archivedAt: t.archivedAt?.toISOString() ?? null,
      canEdit: mayChange(actor, t) && !t.archivedAt,
    };
  }
}

/** Its owner, Owner and Admin, and a Firm Sign Manager for a FIRM one; never a Viewer. */
export function mayChange(actor: EsignActor, t: EsignTemplateRecord): boolean {
  if (actor.role === 'VIEWER') return false;
  return (
    seesAll(actor) ||
    t.ownerUserId === actor.userId ||
    (actor.role === 'MANAGER' && t.visibility === 'FIRM')
  );
}
