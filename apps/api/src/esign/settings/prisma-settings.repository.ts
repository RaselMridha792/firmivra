import { Injectable } from '@nestjs/common';
import type { EsignDefaults } from '@firmivra/types';
import type { Database } from '@firmivra/db';
import { inFirm, InjectDatabase } from '../requests/esign-prisma.js';
import { firmDefaults } from '../requests/prisma-esign.repository.js';
import type {
  EsignConsentRecord,
  EsignSettingsRepository,
  NewEsignConsent,
} from './settings.repository.js';

/** The settings row's columns for a patch of the defaults (only the keys given). */
function settingsColumns(p: Partial<EsignDefaults>) {
  return {
    ...(p.expiryDays !== undefined && { expiryDays: p.expiryDays }),
    ...(p.reminders && {
      reminderFirstAfterDays: p.reminders.firstAfterDays,
      reminderEveryDays: p.reminders.everyDays,
      reminderMax: p.reminders.max,
    }),
    ...(p.expiryWarningDays !== undefined && { expiryWarningDays: p.expiryWarningDays }),
    ...(p.authMethod !== undefined && { authMethod: p.authMethod }),
    ...(p.requireApproval !== undefined && { requireApproval: p.requireApproval }),
    ...(p.emailMessage !== undefined && {
      emailMessage: p.emailMessage?.trim() ? p.emailMessage : null,
    }),
  };
}

/**
 * Signing Settings in PostgreSQL (R13, r0_esign): esign_settings (one row per firm, made on the
 * first change), the insert-only consent versions and the members' job titles, in the firm's
 * scope.
 */
@Injectable()
export class PrismaSettingsRepository implements EsignSettingsRepository {
  constructor(@InjectDatabase() private readonly database: Database) {}

  defaults(businessId: string): Promise<EsignDefaults> {
    return firmDefaults(this.database, businessId);
  }

  async updateDefaults(businessId: string, patch: Partial<EsignDefaults>) {
    const data = settingsColumns(patch);
    await this.database.forBusiness(businessId).esignSettings.upsert({
      where: { businessId },
      create: { ...data, businessId },
      update: data,
    });
    return this.defaults(businessId);
  }

  consentVersions(businessId: string): Promise<EsignConsentRecord[]> {
    return this.database.forBusiness(businessId).esignConsentVersion.findMany({
      where: { businessId },
      orderBy: { version: 'desc' },
      omit: { businessId: true },
    });
  }

  publishConsent(businessId: string, consent: NewEsignConsent): Promise<EsignConsentRecord> {
    return inFirm(this.database, businessId, async (tx) => {
      // One publish at a time per firm, so two never share a number.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`esign-consent:${businessId}`}, 0))`;
      const newest = await tx.esignConsentVersion.aggregate({
        where: { businessId },
        _max: { version: true },
      });
      return tx.esignConsentVersion.create({
        data: { ...consent, businessId, version: (newest._max.version ?? 0) + 1 },
        omit: { businessId: true },
      });
    });
  }

  async jobTitle(businessId: string, userId: string): Promise<string | null> {
    const row = await this.database.forBusiness(businessId).membership.findFirst({
      where: { businessId, userId },
      select: { jobTitle: true },
    });
    return row?.jobTitle ?? null;
  }

  async setJobTitle(businessId: string, userId: string, jobTitle: string | null): Promise<void> {
    await this.database.forBusiness(businessId).membership.updateMany({
      where: { businessId, userId },
      data: { jobTitle: jobTitle?.trim() ? jobTitle : null },
    });
  }
}
