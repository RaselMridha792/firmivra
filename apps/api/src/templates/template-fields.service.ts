import { Inject, Injectable } from '@nestjs/common';
import type { Database, TxClient } from '@firmivra/db';
import type { MergeField, TemplateBranding } from '@firmivra/types';
import type { z } from 'zod';
import { AuditService } from '../audit/audit.service.js';
import type { ClientsActor } from '../clients/clients.service.js';
import { ENV } from '../config/config.module.js';
import type { Env } from '../config/env.js';
import { DATABASE } from '../database/database.module.js';
import { logoUrl } from '../settings/logo-checks.js';
import { isUniqueViolation, notFound } from '../workspaces/common.js';
import { stripTags } from './html.js';
import { BUILT_IN_FIELDS, builtIn } from './merge-fields.js';
import type { BrandingBody, CustomFieldBody } from './template-input.js';
import { isAdmin, templateErrors } from './templates.common.js';

type Field = z.output<typeof CustomFieldBody>;
type Branding = z.output<typeof BrandingBody>;

const ENTITY = 'custom_merge_field';

const toCustom = (c: {
  id: string;
  key: string;
  label: string;
  fallback: string | null;
}): MergeField => ({
  key: c.key,
  token: `[${c.key}]`,
  label: c.label,
  group: 'CUSTOM',
  sensitive: false,
  example: c.fallback ?? c.label,
  customId: c.id,
  fallback: c.fallback,
});

/**
 * The merge-field panel (built-in fields and the firm's custom ones) and Branding & Letterhead.
 * Owner and Admin change them (the routes say so). Money and filing-status fields are listed only
 * to Owner and Admin: they are restricted by role.
 */
@Injectable()
export class TemplateFieldsService {
  constructor(
    @Inject(DATABASE) private readonly database: Database,
    @Inject(ENV) private readonly env: Env,
    private readonly audit: AuditService,
  ) {}

  private inFirm<T>(businessId: string, fn: (tx: TxClient) => Promise<T>): Promise<T> {
    return this.database.withScope({ kind: 'business', businessId }, fn);
  }

  // ---------- Merge fields ----------

  list(businessId: string, actor: ClientsActor): Promise<MergeField[]> {
    return this.inFirm(businessId, async (tx) => {
      const custom = await tx.customMergeField.findMany({
        where: { businessId },
        orderBy: [{ sortOrder: 'asc' }, { key: 'asc' }],
      });
      return [
        ...BUILT_IN_FIELDS.filter((f) => !f.sensitive || isAdmin(actor)).map((f): MergeField => ({
          key: f.key,
          token: `[${f.key}]`,
          label: f.label,
          group: f.group,
          sensitive: f.sensitive,
          example: f.example,
          customId: null,
          fallback: null,
        })),
        ...custom.map(toCustom),
      ];
    });
  }

  async create(businessId: string, body: Field): Promise<MergeField> {
    const row = await this.write(async () =>
      this.inFirm(businessId, async (tx) => {
        await this.checkKey(tx, businessId, body.key);
        const last = await tx.customMergeField.aggregate({
          where: { businessId },
          _max: { sortOrder: true },
        });
        return tx.customMergeField.create({
          data: {
            businessId,
            key: body.key,
            label: stripTags(body.label).trim(),
            fallback: body.fallback ? stripTags(body.fallback).trim() : null,
            sortOrder: (last._max.sortOrder ?? -1) + 1,
          },
        });
      }),
    );
    await this.audit.log('custom_merge_field.created', { type: ENTITY, id: row.id });
    return toCustom(row);
  }

  /** The key can change only while no template uses it (409 FIELD_IN_USE). */
  async update(businessId: string, id: string, body: Field): Promise<MergeField> {
    const row = await this.write(async () =>
      this.inFirm(businessId, async (tx) => {
        const cur = await tx.customMergeField.findFirst({ where: { businessId, id } });
        if (!cur) throw notFound();
        if (body.key.toLowerCase() !== cur.key.toLowerCase()) {
          await this.checkKey(tx, businessId, body.key, id);
          if ((await this.usedBy(tx, businessId, cur.key)) > 0) {
            throw templateErrors.fieldInUse('Templates use this field. Change them first.');
          }
        }
        return tx.customMergeField.update({
          where: { id },
          data: {
            key: body.key,
            label: stripTags(body.label).trim(),
            fallback:
              body.fallback === undefined
                ? cur.fallback
                : stripTags(body.fallback ?? '').trim() || null,
          },
        });
      }),
    );
    await this.audit.log('custom_merge_field.updated', { type: ENTITY, id });
    return toCustom(row);
  }

  async remove(businessId: string, id: string): Promise<void> {
    await this.inFirm(businessId, async (tx) => {
      const cur = await tx.customMergeField.findFirst({ where: { businessId, id } });
      if (!cur) throw notFound();
      if ((await this.usedBy(tx, businessId, cur.key)) > 0) {
        throw templateErrors.fieldInUse('Templates use this field. Remove it from them first.');
      }
      await tx.customMergeField.delete({ where: { id } });
    });
    await this.audit.log('custom_merge_field.deleted', { type: ENTITY, id });
  }

  /** A key that is no built-in field and no other custom field's, ignoring case. */
  private async checkKey(tx: TxClient, businessId: string, key: string, exceptId?: string) {
    if (builtIn(key)) {
      throw templateErrors.fieldInUse('That name belongs to a built-in field');
    }
    const clash = await tx.customMergeField.findFirst({
      where: {
        businessId,
        key: { equals: key, mode: 'insensitive' },
        ...(exceptId ? { id: { not: exceptId } } : {}),
      },
      select: { id: true },
    });
    if (clash) throw templateErrors.duplicateName('merge field');
  }

  /** Templates (not archived) whose subject, preview or body hold `[key]`, in any case. */
  private async usedBy(tx: TxClient, businessId: string, key: string): Promise<number> {
    const token = `[${key.toLowerCase()}]`;
    const [row] = await tx.$queryRaw<{ n: bigint }[]>`
      SELECT count(*) AS n FROM message_templates
      WHERE business_id = ${businessId}::uuid AND status <> 'ARCHIVED'
        AND (position(${token} in lower(body)) > 0
          OR position(${token} in lower(coalesce(subject, ''))) > 0
          OR position(${token} in lower(coalesce(preview_text, ''))) > 0)`;
    return Number(row?.n ?? 0);
  }

  private async write<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (e) {
      if (isUniqueViolation(e)) throw templateErrors.duplicateName('merge field');
      throw e;
    }
  }

  // ---------- Branding & Letterhead ----------

  branding(businessId: string): Promise<TemplateBranding> {
    return this.inFirm(businessId, (tx) => this.brandingIn(tx, businessId));
  }

  async saveBranding(
    businessId: string,
    actor: ClientsActor,
    body: Branding,
  ): Promise<TemplateBranding> {
    const text = (v: string | null | undefined) =>
      v === undefined ? undefined : v === null ? null : stripTags(v).trim() || null;
    const data = {
      footerText: text(body.footerText),
      disclaimer: text(body.disclaimer),
      signatureText: text(body.signatureText),
      letterheadEnabled: body.letterheadEnabled,
      updatedByUserId: actor.userId,
    };
    const result = await this.inFirm(businessId, async (tx) => {
      await tx.templateBranding.upsert({
        where: { businessId },
        create: { businessId, ...data },
        update: data,
      });
      return this.brandingIn(tx, businessId);
    });
    await this.audit.log(
      'template_branding.updated',
      { type: 'template_branding', id: businessId },
      {
        fields: Object.keys(body),
      },
    );
    return result;
  }

  private async brandingIn(tx: TxClient, businessId: string): Promise<TemplateBranding> {
    const [row, firm, settings] = await Promise.all([
      tx.templateBranding.findUnique({ where: { businessId } }),
      tx.business.findUniqueOrThrow({
        where: { id: businessId },
        select: { name: true, slug: true },
      }),
      tx.businessSettings.findUnique({ where: { businessId }, select: { logoKey: true } }),
    ]);
    return {
      footerText: row?.footerText ?? null,
      disclaimer: row?.disclaimer ?? null,
      signatureText: row?.signatureText ?? null,
      letterheadEnabled: row?.letterheadEnabled ?? true,
      businessName: firm.name,
      logoUrl: logoUrl(this.env.PORTAL_BASE_URL, firm.slug, settings?.logoKey),
      updatedAt: row?.updatedAt.toISOString() ?? null,
    };
  }
}
