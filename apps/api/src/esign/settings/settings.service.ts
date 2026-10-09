import { createHash } from 'node:crypto';
import { ForbiddenException, Inject, Injectable } from '@nestjs/common';
import type { z } from 'zod';
import type {
  EsignConsentVersion,
  EsignConsentVersionList,
  EsignDefaults,
  EsignSettings,
  UpdateEsignSettingsBody,
} from '@firmivra/types';
import { AuditService } from '../../audit/audit.service.js';
import { ESIGN_DIRECTORY, type EsignDirectory } from '../requests/esign-directory.js';
import { type EsignActor, seesAll } from '../requests/requests.service.js';
import { type EsignConsentRecord, SETTINGS_REPOSITORY } from './settings.repository.js';
import type { EsignSettingsRepository } from './settings.repository.js';

const forbidden = () =>
  new ForbiddenException({ code: 'FORBIDDEN', message: 'Only an Owner or Admin can change this' });

/**
 * Signing Settings (R13 step 9): everyone in Firm Sign reads them; only an Owner or Admin
 * changes the defaults or publishes a consent version (403 FORBIDDEN otherwise, a Manager
 * included); any member sets their own job title. The audit log gets ids and the names of the
 * changed settings, never the consent text, a message or a title.
 */
@Injectable()
export class EsignSettingsService {
  constructor(
    @Inject(SETTINGS_REPOSITORY) private readonly repo: EsignSettingsRepository,
    @Inject(ESIGN_DIRECTORY) private readonly directory: Pick<EsignDirectory, 'member'>,
    @Inject(AuditService) private readonly audit: Pick<AuditService, 'log'>,
  ) {}

  async get(businessId: string, actor: EsignActor): Promise<EsignSettings> {
    const [defaults, versions, myJobTitle] = await Promise.all([
      this.repo.defaults(businessId),
      this.repo.consentVersions(businessId),
      this.repo.jobTitle(businessId, actor.userId),
    ]);
    const current = versions[0];
    const consent = current ? await this.toVersion(businessId, current) : null;
    return { defaults, consent, canEdit: seesAll(actor), myJobTitle };
  }

  async update(
    businessId: string,
    actor: EsignActor,
    body: z.output<typeof UpdateEsignSettingsBody>,
  ): Promise<EsignSettings> {
    if (!seesAll(actor)) throw forbidden();
    const patch: Partial<EsignDefaults> = Object.fromEntries(
      Object.entries(body).filter(([, v]) => v !== undefined),
    );
    await this.repo.updateDefaults(businessId, patch);
    await this.audit.log(
      'esign.settings_updated',
      { type: 'business', id: businessId },
      { changed: Object.keys(patch) },
    );
    return this.get(businessId, actor);
  }

  async consentVersions(businessId: string): Promise<EsignConsentVersionList> {
    const versions = await this.repo.consentVersions(businessId);
    return { items: await Promise.all(versions.map((v) => this.toVersion(businessId, v))) };
  }

  /** A new version; signers who already accepted keep theirs. */
  async publishConsent(
    businessId: string,
    actor: EsignActor,
    bodyMarkdown: string,
  ): Promise<EsignConsentVersion> {
    if (!seesAll(actor)) throw forbidden();
    const sha256 = createHash('sha256').update(bodyMarkdown, 'utf8').digest('hex');
    const published = await this.repo.publishConsent(businessId, {
      ...{ bodyMarkdown, sha256, publishedAt: new Date(), publishedByUserId: actor.userId },
    });
    await this.audit.log(
      'esign.consent_published',
      { type: 'esign_consent_version', id: published.id },
      { version: published.version, sha256 },
    );
    return this.toVersion(businessId, published);
  }

  /** The caller's own job title (the Staff Title merge field). */
  async updateProfile(
    businessId: string,
    actor: EsignActor,
    jobTitle: string | null,
  ): Promise<EsignSettings> {
    await this.repo.setJobTitle(businessId, actor.userId, jobTitle);
    await this.audit.log('esign.profile_updated', { type: 'user', id: actor.userId }, {});
    return this.get(businessId, actor);
  }

  private async toVersion(businessId: string, v: EsignConsentRecord): Promise<EsignConsentVersion> {
    const by = v.publishedByUserId;
    const member = by ? await this.directory.member(businessId, by) : null;
    return {
      ...{ id: v.id, version: v.version, bodyMarkdown: v.bodyMarkdown, sha256: v.sha256 },
      publishedAt: v.publishedAt.toISOString(),
      publishedBy: member ? { userId: member.userId, name: member.name } : null,
    };
  }
}
