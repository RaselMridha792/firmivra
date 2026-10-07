import { ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import type { Database, TxClient } from '@firmivra/db';
import {
  type FirmLegalOverview,
  type FirmSettings,
  type FirmSetup,
  type LegalDocument,
  type LegalKind,
  SetupStep,
  type UpdateFirmSettingsRequest,
} from '@firmivra/types';
import type { z } from 'zod';
import { AuditService } from '../audit/audit.service.js';
import { DATABASE } from '../database/database.module.js';

type SettingsPatch = z.output<typeof UpdateFirmSettingsRequest>;

const KIND = { terms: 'TERMS', privacy: 'PRIVACY' } as const;

const STEP_NAMES: Record<SetupStep, string> = {
  branding: 'Branding',
  businessDetails: 'Business details',
  team: 'Team and access',
  clientPortal: 'Client portal',
};

const documentSelect = { id: true, version: true, publishedAt: true, body: true } as const;

/** The wizard steps recorded in `setup_progress` ({ "branding": true, ... }), in wizard order. */
export function stepsOf(progress: unknown): SetupStep[] {
  const done =
    typeof progress === 'object' && progress !== null && !Array.isArray(progress)
      ? (progress as Record<string, unknown>)
      : {};
  return SetupStep.options.filter((step) => done[step] === true);
}

/** Once setup is finished every step counts as done (seeded firms have no step progress). */
const toSetup = (steps: SetupStep[], completedAt: Date | null): FirmSetup => ({
  completedSteps: completedAt ? [...SetupStep.options] : steps,
  completedAt: completedAt?.toISOString() ?? null,
});

const toDocument = (
  kind: LegalKind,
  doc: { version: number; publishedAt: Date; body: string },
): LegalDocument => ({
  kind,
  version: doc.version,
  publishedAt: doc.publishedAt.toISOString(),
  body: doc.body,
});

/**
 * Firm settings, the setup wizard and the firm's Terms and Privacy (docs/api/settings.yaml).
 * Every query runs in the firm's business scope; `businessId` always comes from TenantGuard.
 * Audit entries name the changed fields, the step or the version, never the values or text.
 */
@Injectable()
export class SettingsService {
  constructor(
    @Inject(DATABASE) private readonly database: Database,
    private readonly audit: AuditService,
  ) {}

  private inFirm<T>(businessId: string, fn: (tx: TxClient) => Promise<T>): Promise<T> {
    return this.database.withScope({ kind: 'business', businessId }, fn);
  }

  get(businessId: string): Promise<FirmSettings> {
    return this.inFirm(businessId, (tx) => this.view(tx, businessId));
  }

  async update(businessId: string, patch: SettingsPatch): Promise<FirmSettings> {
    const { name, primaryColor, ...rest } = patch;
    const fields = Object.keys(patch).sort();
    const settings = { ...rest, ...(primaryColor !== undefined && { brandColor: primaryColor }) };
    const result = await this.inFirm(businessId, async (tx) => {
      // The settings row before the business row, the same order as Finish: no deadlock.
      if (Object.keys(settings).length > 0) {
        await tx.businessSettings.upsert({
          where: { businessId },
          create: { businessId, ...settings },
          update: settings,
        });
      }
      if (name !== undefined) {
        await tx.business.update({ where: { id: businessId }, data: { name } });
      }
      return this.view(tx, businessId);
    });
    await this.audit.log('settings.updated', { type: 'business', id: businessId }, { fields });
    return result;
  }

  getSetup(businessId: string): Promise<FirmSetup> {
    return this.inFirm(businessId, async (tx) => {
      const row = await tx.businessSettings.findUnique({
        where: { businessId },
        select: { setupProgress: true, setupCompletedAt: true },
      });
      return toSetup(stepsOf(row?.setupProgress), row?.setupCompletedAt ?? null);
    });
  }

  async completeStep(businessId: string, step: SetupStep): Promise<FirmSetup> {
    const { setup, changed } = await this.inFirm(businessId, async (tx) => {
      const row = await this.lockSetup(tx, businessId);
      const steps = stepsOf(row.progress);
      if (row.completedAt || steps.includes(step)) {
        return { setup: toSetup(steps, row.completedAt), changed: false };
      }
      const next = stepsOf(Object.fromEntries([...steps, step].map((s) => [s, true])));
      await tx.businessSettings.update({
        where: { businessId },
        data: { setupProgress: Object.fromEntries(next.map((s) => [s, true])) },
      });
      return { setup: toSetup(next, null), changed: true };
    });
    if (changed) {
      await this.audit.log('setup.step_completed', { type: 'business', id: businessId }, { step });
    }
    return setup;
  }

  /** Finish: needs every step; the firm becomes Active. Repeating returns the first finish. */
  async finishSetup(businessId: string): Promise<FirmSetup> {
    const { setup, changed } = await this.inFirm(businessId, async (tx) => {
      const row = await this.lockSetup(tx, businessId);
      const steps = stepsOf(row.progress);
      if (row.completedAt) {
        // Finished before: make sure the firm is Active too, then answer the first finish.
        await this.activate(tx, businessId);
        return { setup: toSetup(steps, row.completedAt), changed: false };
      }
      const missing = SetupStep.options.filter((s) => !steps.includes(s));
      if (missing.length > 0) {
        throw new ConflictException({
          code: 'SETUP_INCOMPLETE',
          message: `Finish these steps first: ${missing.map((s) => STEP_NAMES[s]).join(', ')}`,
        });
      }
      const { setupCompletedAt } = await tx.businessSettings.update({
        where: { businessId },
        data: { setupCompletedAt: new Date() },
        select: { setupCompletedAt: true },
      });
      await this.activate(tx, businessId);
      return { setup: toSetup(steps, setupCompletedAt), changed: true };
    });
    if (changed) await this.audit.log('setup.finished', { type: 'business', id: businessId });
    return setup;
  }

  getLegal(businessId: string, kind: LegalKind): Promise<FirmLegalOverview> {
    return this.inFirm(businessId, async (tx) => {
      const where = { businessId, kind: KIND[kind] };
      const versions = await tx.firmLegalDocument.findMany({
        where,
        orderBy: { version: 'desc' },
        select: { version: true, publishedAt: true },
      });
      // The newest listed version, by key, so `current` and `versions` always agree.
      const newest = versions[0];
      const current = newest
        ? await tx.firmLegalDocument.findUnique({
            where: { businessId_kind_version: { ...where, version: newest.version } },
            select: documentSelect,
          })
        : null;
      return {
        current: current ? toDocument(kind, current) : null,
        versions: versions.map((v) => ({
          version: v.version,
          publishedAt: v.publishedAt.toISOString(),
        })),
      };
    });
  }

  async getLegalVersion(
    businessId: string,
    kind: LegalKind,
    version: number,
  ): Promise<LegalDocument> {
    const doc = await this.database.forBusiness(businessId).firmLegalDocument.findUnique({
      where: { businessId_kind_version: { businessId, kind: KIND[kind], version } },
      select: documentSelect,
    });
    if (!doc) throw new NotFoundException({ code: 'NOT_FOUND', message: 'Not found' });
    return toDocument(kind, doc);
  }

  /** Publishes the next version. Versions are never edited; clients see the newest at once. */
  async publishLegal(
    businessId: string,
    kind: LegalKind,
    body: string,
    userId: string,
  ): Promise<LegalDocument> {
    const doc = await this.inFirm(businessId, async (tx) => {
      // One publisher at a time per firm and kind, so two at once get consecutive versions.
      const key = `firm_legal_documents:${businessId}:${kind}`;
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${key}, 0))`;
      const last = await tx.firmLegalDocument.findFirst({
        where: { businessId, kind: KIND[kind] },
        orderBy: { version: 'desc' },
        select: { version: true },
      });
      return tx.firmLegalDocument.create({
        data: {
          businessId,
          kind: KIND[kind],
          version: (last?.version ?? 0) + 1,
          body,
          publishedByUserId: userId,
        },
        select: documentSelect,
      });
    });
    await this.audit.log(
      'legal.published',
      { type: 'firm_legal_document', id: doc.id },
      { kind, version: doc.version },
    );
    return toDocument(kind, doc);
  }

  /** The database lets a firm move itself only from PENDING_SETUP to ACTIVE, once setup is done. */
  private async activate(tx: TxClient, businessId: string): Promise<void> {
    await tx.business.updateMany({
      where: { id: businessId, status: 'PENDING_SETUP' },
      data: { status: 'ACTIVE' },
    });
  }

  /** The firm's settings row, created if missing and locked until the transaction ends. */
  private async lockSetup(tx: TxClient, businessId: string) {
    // ON CONFLICT DO NOTHING, not Prisma's upsert: with an empty update it reads, then inserts,
    // so two first saves at once would collide on the primary key.
    await tx.$executeRaw`
      INSERT INTO business_settings (business_id, updated_at) VALUES (${businessId}::uuid, now())
      ON CONFLICT (business_id) DO NOTHING`;
    const [row] = await tx.$queryRaw<{ progress: unknown; completedAt: Date | null }[]>`
      SELECT setup_progress AS progress, setup_completed_at AS "completedAt"
      FROM business_settings WHERE business_id = ${businessId}::uuid FOR UPDATE`;
    if (!row) throw new Error('business_settings row missing after upsert');
    return row;
  }

  private async view(tx: TxClient, businessId: string): Promise<FirmSettings> {
    const business = await tx.business.findUniqueOrThrow({
      where: { id: businessId },
      select: { id: true, slug: true, legalName: true, status: true, name: true, updatedAt: true },
    });
    const s = await tx.businessSettings.findUnique({ where: { businessId } });
    const updatedAt = s && s.updatedAt > business.updatedAt ? s.updatedAt : business.updatedAt;
    return {
      business: {
        id: business.id,
        slug: business.slug,
        legalName: business.legalName,
        status: business.status,
      },
      name: business.name,
      contactEmail: s?.contactEmail ?? null,
      contactPhone: s?.contactPhone ?? null,
      website: s?.website ?? null,
      addressLine1: s?.addressLine1 ?? null,
      addressLine2: s?.addressLine2 ?? null,
      city: s?.city ?? null,
      state: s?.state ?? null,
      postalCode: s?.postalCode ?? null,
      // The column defaults, for a firm that has not saved settings yet.
      country: s?.country ?? 'US',
      timezone: s?.timezone ?? 'America/New_York',
      // R5 turns logo_key into a short-lived signed URL.
      logoUrl: null,
      primaryColor: s?.brandColor ?? null,
      accentColor: s?.accentColor ?? null,
      portalName: s?.portalName ?? null,
      portalHeader: s?.portalHeader ?? null,
      welcomeMessage: s?.welcomeMessage ?? null,
      clientSignUpEnabled: s?.clientSignUpEnabled ?? true,
      updatedAt: updatedAt.toISOString(),
    };
  }
}
