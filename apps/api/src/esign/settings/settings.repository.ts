import type { EsignDefaults } from '@firmivra/types';

// Firm Sign's Signing Settings storage (R13): the firm's defaults for new requests, its consent
// text versions and each member's job title. Like the other esign ports, every method takes the
// firm first, and the Prisma implementation (with r0_esign) uses only forBusiness(businessId).
// Until then the API has notMigrated() and tests use InMemorySettingsRepository.

/** One esign_consent_versions row. Insert-only: a version is never changed or deleted. */
export interface EsignConsentRecord {
  id: string;
  version: number;
  bodyMarkdown: string;
  /** Hex SHA-256 of `bodyMarkdown` (UTF-8), for the certificate. */
  sha256: string;
  publishedAt: Date;
  /** The member who published it; null for a version the platform seeded. */
  publishedByUserId: string | null;
}

export type NewEsignConsent = Omit<EsignConsentRecord, 'id' | 'version'>;

export interface EsignSettingsRepository {
  /** The firm's defaults; the platform's defaults until the firm changes one. */
  defaults(businessId: string): Promise<EsignDefaults>;
  /** Changes only the keys given and returns the defaults as written. */
  updateDefaults(businessId: string, patch: Partial<EsignDefaults>): Promise<EsignDefaults>;
  /** Every version, newest first. */
  consentVersions(businessId: string): Promise<EsignConsentRecord[]>;
  /**
   * Adds the next version (the firm's highest plus one, under a per-firm lock, so two publishes
   * never share a number). Signers accept it from then on; a signer's pinned version stays.
   */
  publishConsent(businessId: string, consent: NewEsignConsent): Promise<EsignConsentRecord>;
  /** The member's own job title (the Staff Title merge field); null when none. */
  jobTitle(businessId: string, userId: string): Promise<string | null>;
  setJobTitle(businessId: string, userId: string, jobTitle: string | null): Promise<void>;
}

export const SETTINGS_REPOSITORY = Symbol('ESIGN_SETTINGS_REPOSITORY');
