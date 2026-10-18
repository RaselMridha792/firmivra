import { Inject, Injectable } from '@nestjs/common';
import type { Database, Prisma, TxClient } from '@firmivra/db';
import type {
  BulkTemplatesResult,
  ImportTemplateResult,
  MessageTemplateDetail,
  MessageTemplateKind,
  RenderedTemplate,
} from '@firmivra/types';
import type { z } from 'zod';
import { AuditService } from '../audit/audit.service.js';
import type { ClientsActor } from '../clients/clients.service.js';
import { DATABASE } from '../database/database.module.js';
import { isUniqueViolation, notFound } from '../workspaces/common.js';
import { escapeHtml } from './merge-fields.js';
import { sanitize, stripTags, toPlainText } from './html.js';
import type {
  ArchiveTemplateBody,
  BulkBody,
  CreateTemplateBody,
  ImportBody,
  PreviewBody,
  SharesBody,
  UpdateTemplateBody,
} from './template-input.js';
import { TemplateReadService, automationCount } from './template-read.service.js';
import { TemplateRenderService } from './template-render.service.js';
import {
  AUTOMATION_KINDS,
  PLAIN_KINDS,
  SUBJECT_KINDS,
  canEdit,
  canShare,
  etagOf,
  templateErrors,
  visibleTo,
} from './templates.common.js';

type Create = z.output<typeof CreateTemplateBody>;
type Update = z.output<typeof UpdateTemplateBody>;
type Archive = z.output<typeof ArchiveTemplateBody>;
type Shares = z.output<typeof SharesBody>;
type Bulk = z.output<typeof BulkBody>;
type Preview = z.output<typeof PreviewBody>;
type Import = z.output<typeof ImportBody>;

const ENTITY = 'message_template';
const MAX_TAGS = 20;

/** The master text as stored: a body is rich text (or plain for SMS and tasks), never scripts. */
export function cleanBody(kind: MessageTemplateKind, body: string): string {
  return PLAIN_KINDS.has(kind) ? stripTags(body).trim() : sanitize(body).html.trim();
}
const plainLine = (s: string | null | undefined) =>
  s === null || s === undefined ? s : stripTags(s).trim() || null;

/** What a new template is made from (the form, an import or a starter). */
export interface NewTemplate {
  kind: MessageTemplateKind;
  name: string;
  categoryId?: string | null;
  description?: string | null;
  subject?: string | null;
  previewText?: string | null;
  body: string;
  status?: 'DRAFT' | 'ACTIVE';
  access?: 'PRIVATE' | 'TEAM' | 'SELECTED';
  sharedWithUserIds?: string[];
  tags?: string[];
  includeInAutomations?: boolean;
  starterKey?: string | null;
}

/**
 * Writes of the Templates library: create, change (a version for every change of name, subject or
 * body), duplicate, archive and restore, favourites, sharing, versions and bulk actions, preview,
 * test send and import. Archived, never deleted. A template that is not the caller's to see is
 * NOT_FOUND; one they see but may not change is 403 NOT_THE_OWNER. A foreign id in a body (a
 * category, a person) answers as an unknown one. Audited with ids, versions and field names only.
 */
@Injectable()
export class TemplatesService {
  constructor(
    @Inject(DATABASE) private readonly database: Database,
    private readonly audit: AuditService,
    private readonly reader: TemplateReadService,
    private readonly renderer: TemplateRenderService,
  ) {}

  private inFirm<T>(businessId: string, fn: (tx: TxClient) => Promise<T>): Promise<T> {
    return this.database.withScope({ kind: 'business', businessId }, fn);
  }

  private async write<T>(businessId: string, fn: (tx: TxClient) => Promise<T>): Promise<T> {
    try {
      return await this.inFirm(businessId, fn);
    } catch (e) {
      if (isUniqueViolation(e)) throw templateErrors.duplicateName('template');
      throw e;
    }
  }

  // ---------- Create ----------

  async create(
    businessId: string,
    actor: ClientsActor,
    body: Create,
  ): Promise<MessageTemplateDetail> {
    const detail = await this.write(businessId, async (tx) => {
      const id = await this.insert(tx, businessId, actor, body);
      return this.reader.detailIn(tx, businessId, actor, id);
    });
    await this.audit.log(
      'message_template.created',
      { type: ENTITY, id: detail.id },
      {
        kind: detail.kind,
        status: detail.status,
      },
    );
    return detail;
  }

  /** Inserts a template and its first version; returns the id. Also used by import and starters. */
  async insert(
    tx: TxClient,
    businessId: string,
    actor: ClientsActor,
    input: NewTemplate,
  ): Promise<string> {
    const status = input.status ?? 'DRAFT';
    const access = input.access ?? 'TEAM';
    const subject = plainLine(input.subject) ?? null;
    const body = cleanBody(input.kind, input.body);
    if (body === '') throw templateErrors.invalid('body', 'Write the template');
    if (status === 'ACTIVE' && SUBJECT_KINDS.has(input.kind) && !subject) {
      throw templateErrors.subjectRequired();
    }
    const includeInAutomations = input.includeInAutomations ?? false;
    if (includeInAutomations && !(status === 'ACTIVE' && AUTOMATION_KINDS.has(input.kind))) {
      throw templateErrors.notAutomationEligible();
    }
    if (input.sharedWithUserIds?.length && access !== 'SELECTED') {
      throw templateErrors.invalid(
        'sharedWithUserIds',
        'Choose “Selected people” to share with people',
      );
    }
    await this.checkCategory(tx, businessId, input.kind, input.categoryId ?? null);
    const shares = [...new Set(input.sharedWithUserIds ?? [])];
    await this.checkMembers(tx, businessId, shares);
    const name = stripTags(input.name).trim();
    await this.uniqueName(tx, businessId, input.kind, name);
    const row = await tx.messageTemplate.create({
      data: {
        businessId,
        kind: input.kind,
        categoryId: input.categoryId ?? null,
        name,
        description: plainLine(input.description) ?? null,
        subject,
        previewText: plainLine(input.previewText) ?? null,
        body,
        status,
        access,
        tags: input.tags ?? [],
        includeInAutomations,
        starterKey: input.starterKey ?? null,
        ownerUserId: actor.userId,
        updatedByUserId: actor.userId,
      },
      select: { id: true },
    });
    await tx.messageTemplateVersion.create({
      data: {
        businessId,
        templateId: row.id,
        version: 1,
        name,
        subject,
        body,
        savedByUserId: actor.userId,
      },
    });
    if (access === 'SELECTED' && shares.length) {
      await tx.messageTemplateShare.createMany({
        data: shares.map((userId) => ({ businessId, templateId: row.id, userId })),
      });
    }
    return row.id;
  }

  // ---------- Change ----------

  async update(
    businessId: string,
    actor: ClientsActor,
    id: string,
    body: Update,
  ): Promise<MessageTemplateDetail> {
    const { detail, fields, version } = await this.write(businessId, async (tx) => {
      const cur = await this.lock(tx, businessId, actor, id);
      if (!canEdit(cur, actor)) throw templateErrors.notTheOwner();
      if (cur.status === 'ARCHIVED') throw templateErrors.archived();
      if (body.etag !== etagOf(cur)) throw templateErrors.saveConflict();

      const kind = cur.kind;
      const next = {
        name: body.name === undefined ? cur.name : stripTags(body.name).trim(),
        subject: body.subject === undefined ? cur.subject : plainLine(body.subject),
        previewText: body.previewText === undefined ? cur.previewText : plainLine(body.previewText),
        description: body.description === undefined ? cur.description : plainLine(body.description),
        body: body.body === undefined ? cur.body : cleanBody(kind, body.body),
        status: body.status ?? cur.status,
        access: body.access ?? cur.access,
        tags: body.tags ?? cur.tags,
        categoryId: body.categoryId === undefined ? cur.categoryId : body.categoryId,
      };
      if (next.body === '') throw templateErrors.invalid('body', 'Write the template');
      if (body.access !== undefined || body.sharedWithUserIds !== undefined) {
        if (!canShare(cur, actor)) throw templateErrors.notTheOwner();
      }
      if (body.sharedWithUserIds?.length && next.access !== 'SELECTED') {
        throw templateErrors.invalid(
          'sharedWithUserIds',
          'Choose “Selected people” to share with people',
        );
      }
      if (next.status === 'ACTIVE' && SUBJECT_KINDS.has(kind) && !next.subject) {
        throw templateErrors.subjectRequired();
      }
      // Leaving ACTIVE ends the automation offer; asking for it needs an eligible active template.
      let includeInAutomations = body.includeInAutomations ?? cur.includeInAutomations;
      if (next.status !== 'ACTIVE') includeInAutomations = false;
      if (
        body.includeInAutomations === true &&
        !(next.status === 'ACTIVE' && AUTOMATION_KINDS.has(kind))
      ) {
        throw templateErrors.notAutomationEligible();
      }
      if (body.categoryId !== undefined) {
        await this.checkCategory(tx, businessId, kind, next.categoryId);
      }
      if (next.name !== cur.name) await this.uniqueName(tx, businessId, kind, next.name, id);

      const textChanged =
        next.name !== cur.name || next.subject !== cur.subject || next.body !== cur.body;
      const disruptive =
        textChanged ||
        (cur.status === 'ACTIVE' && next.status !== 'ACTIVE') ||
        (cur.includeInAutomations && !includeInAutomations);
      if (disruptive && !body.confirmAutomationImpact) {
        const used = await automationCount(tx, businessId, id);
        if (used > 0) throw templateErrors.automationInUse(used);
      }

      const version = textChanged ? cur.version + 1 : cur.version;
      await tx.messageTemplate.update({
        where: { id },
        data: {
          name: next.name,
          subject: next.subject,
          previewText: next.previewText,
          description: next.description,
          body: next.body,
          status: next.status,
          access: next.access,
          tags: next.tags,
          categoryId: next.categoryId,
          includeInAutomations,
          version,
          updatedByUserId: actor.userId,
        },
      });
      if (textChanged) {
        await tx.messageTemplateVersion.create({
          data: {
            businessId,
            templateId: id,
            version,
            name: next.name,
            subject: next.subject,
            body: next.body,
            savedByUserId: actor.userId,
          },
        });
      }
      if (body.access !== undefined || body.sharedWithUserIds !== undefined) {
        await this.replaceShares(
          tx,
          businessId,
          id,
          next.access === 'SELECTED' ? (body.sharedWithUserIds ?? null) : [],
        );
      }
      const fields = Object.keys(body).filter(
        (k) => k !== 'etag' && k !== 'confirmAutomationImpact',
      );
      return { detail: await this.reader.detailIn(tx, businessId, actor, id), fields, version };
    });
    await this.audit.log('message_template.updated', { type: ENTITY, id }, { fields, version });
    return detail;
  }

  // ---------- Duplicate, archive, restore ----------

  async duplicate(
    businessId: string,
    actor: ClientsActor,
    id: string,
  ): Promise<MessageTemplateDetail> {
    const detail = await this.write(businessId, async (tx) => {
      const src = await this.find(tx, businessId, actor, id);
      const name = await this.copyName(tx, businessId, src.kind, src.name);
      const newId = await this.insert(tx, businessId, actor, {
        kind: src.kind,
        name,
        categoryId: src.category && !src.category.archivedAt ? src.categoryId : null,
        description: src.description,
        subject: src.subject,
        previewText: src.previewText,
        body: src.body,
        status: 'DRAFT',
        access: 'PRIVATE',
        tags: src.tags,
      });
      return this.reader.detailIn(tx, businessId, actor, newId);
    });
    await this.audit.log(
      'message_template.duplicated',
      { type: ENTITY, id: detail.id },
      {
        sourceId: id,
      },
    );
    return detail;
  }

  async archive(
    businessId: string,
    actor: ClientsActor,
    id: string,
    body: Archive,
  ): Promise<MessageTemplateDetail> {
    const { detail, changed } = await this.write(businessId, async (tx) => {
      const cur = await this.lock(tx, businessId, actor, id);
      if (!canEdit(cur, actor)) throw templateErrors.notTheOwner();
      if (cur.status !== 'ARCHIVED') {
        if (!body.confirmAutomationImpact) {
          const used = await automationCount(tx, businessId, id);
          if (used > 0) throw templateErrors.automationInUse(used);
        }
        await tx.messageTemplate.update({
          where: { id },
          data: {
            status: 'ARCHIVED',
            archivedAt: new Date(),
            includeInAutomations: false,
            updatedByUserId: actor.userId,
          },
        });
      }
      return {
        detail: await this.reader.detailIn(tx, businessId, actor, id),
        changed: cur.status !== 'ARCHIVED',
      };
    });
    if (changed) await this.audit.log('message_template.archived', { type: ENTITY, id });
    return detail;
  }

  async restore(
    businessId: string,
    actor: ClientsActor,
    id: string,
  ): Promise<MessageTemplateDetail> {
    const { detail, changed } = await this.write(businessId, async (tx) => {
      const cur = await this.lock(tx, businessId, actor, id);
      if (!canEdit(cur, actor)) throw templateErrors.notTheOwner();
      if (cur.status === 'ARCHIVED') {
        await this.uniqueName(tx, businessId, cur.kind, cur.name, id);
        await tx.messageTemplate.update({
          where: { id },
          data: { status: 'DRAFT', archivedAt: null, updatedByUserId: actor.userId },
        });
      }
      return {
        detail: await this.reader.detailIn(tx, businessId, actor, id),
        changed: cur.status === 'ARCHIVED',
      };
    });
    if (changed) await this.audit.log('message_template.restored', { type: ENTITY, id });
    return detail;
  }

  // ---------- Favourites and sharing ----------

  async favorite(
    businessId: string,
    actor: ClientsActor,
    id: string,
    on: boolean,
  ): Promise<MessageTemplateDetail> {
    const detail = await this.inFirm(businessId, async (tx) => {
      await this.find(tx, businessId, actor, id);
      if (on) {
        await tx.messageTemplateFavorite.createMany({
          data: [{ businessId, templateId: id, userId: actor.userId }],
          skipDuplicates: true,
        });
      } else {
        await tx.messageTemplateFavorite.deleteMany({
          where: { businessId, templateId: id, userId: actor.userId },
        });
      }
      return this.reader.detailIn(tx, businessId, actor, id);
    });
    await this.audit.log(on ? 'message_template.favorited' : 'message_template.unfavorited', {
      type: ENTITY,
      id,
    });
    return detail;
  }

  async setShares(
    businessId: string,
    actor: ClientsActor,
    id: string,
    body: Shares,
  ): Promise<MessageTemplateDetail> {
    const detail = await this.write(businessId, async (tx) => {
      const cur = await this.lock(tx, businessId, actor, id);
      if (!canShare(cur, actor)) throw templateErrors.notTheOwner();
      if (cur.status === 'ARCHIVED') throw templateErrors.archived();
      const userIds = [...new Set(body.userIds)];
      await this.checkMembers(tx, businessId, userIds);
      await tx.messageTemplate.update({
        where: { id },
        data: { access: 'SELECTED', updatedByUserId: actor.userId },
      });
      await this.replaceShares(tx, businessId, id, userIds);
      return this.reader.detailIn(tx, businessId, actor, id);
    });
    await this.audit.log(
      'message_template.shared',
      { type: ENTITY, id },
      {
        people: new Set(body.userIds).size,
      },
    );
    return detail;
  }

  // ---------- Versions ----------

  /** A new version with an old one's name, subject and body; nothing is lost. */
  async restoreVersion(
    businessId: string,
    actor: ClientsActor,
    id: string,
    version: number,
  ): Promise<MessageTemplateDetail> {
    const { detail, saved } = await this.write(businessId, async (tx) => {
      const cur = await this.lock(tx, businessId, actor, id);
      if (!canEdit(cur, actor)) throw templateErrors.notTheOwner();
      if (cur.status === 'ARCHIVED') throw templateErrors.archived();
      const old = await tx.messageTemplateVersion.findFirst({
        where: { businessId, templateId: id, version },
      });
      if (!old) throw notFound();
      if (old.name !== cur.name) await this.uniqueName(tx, businessId, cur.kind, old.name, id);
      const next = cur.version + 1;
      await tx.messageTemplate.update({
        where: { id },
        data: {
          name: old.name,
          subject: old.subject,
          body: old.body,
          version: next,
          updatedByUserId: actor.userId,
        },
      });
      await tx.messageTemplateVersion.create({
        data: {
          businessId,
          templateId: id,
          version: next,
          name: old.name,
          subject: old.subject,
          body: old.body,
          savedByUserId: actor.userId,
        },
      });
      return { detail: await this.reader.detailIn(tx, businessId, actor, id), saved: next };
    });
    await this.audit.log(
      'message_template.version_restored',
      { type: ENTITY, id },
      {
        from: version,
        version: saved,
      },
    );
    return detail;
  }

  // ---------- Bulk ----------

  /**
   * One action on up to 100 templates. A template the caller can't see is not found; one they see
   * but may not change, or that the action does not fit, is skipped with a reason. None found: 404.
   */
  async bulk(businessId: string, actor: ClientsActor, body: Bulk): Promise<BulkTemplatesResult> {
    const ids = [...new Set(body.ids)];
    const result = await this.inFirm(businessId, async (tx) => {
      const rows = await tx.messageTemplate.findMany({
        where: { businessId, id: { in: ids }, ...visibleTo(actor) },
        select: {
          id: true,
          kind: true,
          status: true,
          access: true,
          ownerUserId: true,
          tags: true,
          categoryId: true,
        },
      });
      if (rows.length === 0) throw notFound();
      const found = new Map(rows.map((r) => [r.id, r]));
      const skipped: { id: string; reason: string }[] = ids
        .filter((id) => !found.has(id))
        .map((id) => ({ id, reason: 'NOT_FOUND' }));
      const changed: string[] = [];
      let category: { id: string; kind: MessageTemplateKind } | null = null;
      if (body.action === 'SET_CATEGORY' && body.categoryId) {
        category = await tx.templateCategory.findFirst({
          where: { businessId, id: body.categoryId, archivedAt: null },
          select: { id: true, kind: true },
        });
        if (!category) throw templateErrors.categoryNotAllowed();
      }
      for (const t of rows) {
        if (!canEdit(t, actor)) {
          skipped.push({ id: t.id, reason: 'NOT_THE_OWNER' });
          continue;
        }
        const patch: Prisma.MessageTemplateUncheckedUpdateInput = { updatedByUserId: actor.userId };
        if (body.action === 'ARCHIVE') {
          if (t.status === 'ARCHIVED') {
            skipped.push({ id: t.id, reason: 'ALREADY_ARCHIVED' });
            continue;
          }
          patch.status = 'ARCHIVED';
          patch.archivedAt = new Date();
          patch.includeInAutomations = false;
        } else if (body.action === 'SET_CATEGORY') {
          if (category && category.kind !== t.kind) {
            skipped.push({ id: t.id, reason: 'CATEGORY_NOT_ALLOWED' });
            continue;
          }
          patch.categoryId = category?.id ?? null;
        } else if (body.action === 'ADD_TAG') {
          if (t.tags.some((x) => x.toLowerCase() === body.tag.toLowerCase())) {
            skipped.push({ id: t.id, reason: 'ALREADY_TAGGED' });
            continue;
          }
          if (t.tags.length >= MAX_TAGS) {
            skipped.push({ id: t.id, reason: 'TOO_MANY_TAGS' });
            continue;
          }
          patch.tags = [...t.tags, body.tag];
        } else {
          if (!t.tags.some((x) => x.toLowerCase() === body.tag.toLowerCase())) {
            skipped.push({ id: t.id, reason: 'NOT_TAGGED' });
            continue;
          }
          patch.tags = t.tags.filter((x) => x.toLowerCase() !== body.tag.toLowerCase());
        }
        await tx.messageTemplate.update({ where: { id: t.id }, data: patch });
        changed.push(t.id);
      }
      return { updated: changed.length, skipped, changed };
    });
    await this.audit.log(
      'message_template.bulk',
      { type: ENTITY, id: result.changed[0] ?? ids[0]! },
      {
        action: body.action,
        ids: result.changed,
      },
    );
    return { updated: result.updated, skipped: result.skipped };
  }

  // ---------- Preview, test send, import ----------

  /** Nothing is sent or recorded. With a client's data, the read is audited (ids only). */
  async preview(
    businessId: string,
    actor: ClientsActor,
    id: string,
    body: Preview,
  ): Promise<RenderedTemplate> {
    const live = Boolean(body.clientId ?? body.appointmentId ?? body.invoiceId ?? body.taskId);
    const rendered = await this.inFirm(businessId, async (tx) => {
      const t = await this.find(tx, businessId, actor, id);
      const base = live
        ? await this.renderer.liveValues(tx, businessId, actor, body)
        : await this.renderer.sampleValues(tx, businessId);
      const values = this.renderer.withSample(base, body.sample);
      return this.renderer.render(t, values, !live);
    });
    if (live) {
      await this.audit.log(
        'message_template.previewed',
        { type: ENTITY, id },
        {
          ...(body.clientId ? { clientId: body.clientId } : {}),
        },
      );
    }
    return rendered;
  }

  /**
   * To the caller's own address or number only. The destination is checked (400
   * TEST_SEND_REFUSED); the sending itself needs a Templates message in the notify service, which
   * is not there yet, so a valid request answers 503 TEST_SEND_UNAVAILABLE and nothing is sent.
   */
  async testSend(
    businessId: string,
    actor: ClientsActor,
    id: string,
    body: { channel: 'EMAIL' | 'SMS'; toEmail?: string | undefined; toPhone?: string | undefined },
  ): Promise<never> {
    await this.inFirm(businessId, async (tx) => {
      const t = await this.find(tx, businessId, actor, id);
      const me = await tx.user.findUnique({
        where: { id: actor.userId },
        select: { email: true, phone: true },
      });
      const wrong =
        (body.channel === 'SMS') !== (t.kind === 'SMS') ||
        (body.channel === 'EMAIL' &&
          body.toEmail !== undefined &&
          body.toEmail.toLowerCase() !== me?.email.toLowerCase()) ||
        (body.channel === 'SMS' && (!me?.phone || (body.toPhone ?? me.phone) !== me.phone));
      if (wrong) throw templateErrors.testRefused();
    });
    throw templateErrors.testUnavailable();
  }

  async importTemplate(
    businessId: string,
    actor: ClientsActor,
    body: Import,
  ): Promise<ImportTemplateResult> {
    const plain = PLAIN_KINDS.has(body.kind);
    let removed = 0;
    let text: string;
    if (body.format === 'HTML') {
      const clean = sanitize(body.content);
      removed = clean.removed;
      text = plain ? toPlainText(clean.html) : clean.html;
    } else {
      text = plain
        ? body.content
        : body.content
            .split(/\n{2,}/)
            .map((p) => `<p>${escapeHtml(p.trim()).replace(/\n/g, '<br>')}</p>`)
            .join('');
    }
    const template = await this.write(businessId, async (tx) => {
      const id = await this.insert(tx, businessId, actor, {
        kind: body.kind,
        name: body.name,
        categoryId: body.categoryId ?? null,
        body: text,
        status: 'DRAFT',
        access: 'PRIVATE',
      });
      return this.reader.detailIn(tx, businessId, actor, id);
    });
    await this.audit.log(
      'message_template.imported',
      { type: ENTITY, id: template.id },
      {
        format: body.format,
        removed,
      },
    );
    return { template, removed };
  }

  // ---------- Helpers ----------

  /** A template the actor may see (any status), or 404. */
  private async find(tx: TxClient, businessId: string, actor: ClientsActor, id: string) {
    const t = await tx.messageTemplate.findFirst({
      where: { businessId, id, ...visibleTo(actor) },
      include: { category: { select: { id: true, archivedAt: true } } },
    });
    if (!t) throw notFound();
    return t;
  }

  /** As find, with the row locked so two saves of one template run one after the other. */
  private async lock(tx: TxClient, businessId: string, actor: ClientsActor, id: string) {
    await this.find(tx, businessId, actor, id);
    await tx.$queryRaw`SELECT id FROM message_templates WHERE business_id = ${businessId}::uuid AND id = ${id}::uuid FOR UPDATE`;
    const t = await tx.messageTemplate.findFirstOrThrow({ where: { businessId, id } });
    return t;
  }

  /** An active category of the template's own kind, or 409 CATEGORY_NOT_ALLOWED. */
  private async checkCategory(
    tx: TxClient,
    businessId: string,
    kind: MessageTemplateKind,
    categoryId: string | null,
  ) {
    if (!categoryId) return;
    const c = await tx.templateCategory.findFirst({
      where: { businessId, id: categoryId, kind, archivedAt: null },
      select: { id: true },
    });
    if (!c) throw templateErrors.categoryNotAllowed();
  }

  /** Every person must be a member of the firm (409 NOT_A_MEMBER), as for any other id in a body. */
  private async checkMembers(tx: TxClient, businessId: string, userIds: string[]) {
    if (userIds.length === 0) return;
    const n = await tx.membership.count({
      where: { businessId, userId: { in: userIds }, joinedAt: { not: null } },
    });
    if (n !== userIds.length) throw templateErrors.notAMember();
  }

  private async replaceShares(
    tx: TxClient,
    businessId: string,
    templateId: string,
    userIds: string[] | null,
  ) {
    if (userIds === null) return;
    await this.checkMembers(tx, businessId, userIds);
    await tx.messageTemplateShare.deleteMany({ where: { businessId, templateId } });
    if (userIds.length) {
      await tx.messageTemplateShare.createMany({
        data: [...new Set(userIds)].map((userId) => ({ businessId, templateId, userId })),
      });
    }
  }

  /** Names are unique in a kind among templates that are not archived, ignoring case. */
  private async uniqueName(
    tx: TxClient,
    businessId: string,
    kind: MessageTemplateKind,
    name: string,
    exceptId?: string,
  ) {
    const clash = await tx.messageTemplate.findFirst({
      where: {
        businessId,
        kind,
        status: { not: 'ARCHIVED' },
        name: { equals: name, mode: 'insensitive' },
        ...(exceptId ? { id: { not: exceptId } } : {}),
      },
      select: { id: true },
    });
    if (clash) throw templateErrors.duplicateName('template');
  }

  /** "Welcome (Copy)", then "Welcome (Copy 2)"... */
  private async copyName(
    tx: TxClient,
    businessId: string,
    kind: MessageTemplateKind,
    name: string,
  ) {
    const base = name.replace(/ \(Copy( \d+)?\)$/, '').slice(0, 190);
    for (let n = 1; n < 100; n++) {
      const candidate = n === 1 ? `${base} (Copy)` : `${base} (Copy ${n})`;
      const clash = await tx.messageTemplate.findFirst({
        where: {
          businessId,
          kind,
          status: { not: 'ARCHIVED' },
          name: { equals: candidate, mode: 'insensitive' },
        },
        select: { id: true },
      });
      if (!clash) return candidate;
    }
    throw templateErrors.duplicateName('template');
  }
}
