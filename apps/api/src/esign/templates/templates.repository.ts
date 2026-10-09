import type {
  EsignReminders,
  EsignRouting,
  EsignTemplateField,
  EsignTemplateRole,
  EsignTemplateVisibility,
} from '@firmivra/types';
import type { PageSize } from '../engine/engine.types.js';

// Firm Sign's templates storage (R13). Like the other esign ports, every method takes the firm
// (`businessId`, from the tenant context) first, and the Prisma implementation (with r0_esign:
// esign_templates and esign_template_versions) uses only forBusiness(businessId), never the owner
// client. A template holds nothing of one client: its versions keep the packet, the roles, the
// fields and the settings (SaveEsignTemplateBody). Versions are insert-only. Until r0_esign the API
// has notMigrated() and tests use InMemoryTemplateRepository (test/unit/esign-fakes.ts).

/** An esign_templates row. `version` is the newest one: the one `use` copies. */
export interface EsignTemplateRecord {
  id: string;
  name: string;
  description: string | null;
  visibility: EsignTemplateVisibility;
  ownerUserId: string;
  version: number;
  createdAt: Date;
  /**
   * The optimistic lock: every write moves it strictly forward (GREATEST(now(), old + 1 ms), as
   * the requests' lastActivityAt), and a write with an older `readAt` is refused.
   */
  updatedAt: Date;
  archivedAt: Date | null;
}

/** What a version holds: what using the template copies. */
export interface EsignTemplateContent {
  /**
   * The packet (the request's pages in order, each already turned), a CLEAN PDF in the template's
   * own folder: tenant/<businessId>/esign/<templateId>/template-<sha256>.pdf.
   */
  s3Key: string;
  sha256: string;
  sizeBytes: number;
  pageSizes: PageSize[];
  roles: EsignTemplateRole[];
  fields: EsignTemplateField[];
  routing: EsignRouting;
  expiryDays: number;
  reminders: EsignReminders;
  expiryWarningDays: number;
  emailSubject: string | null;
  emailMessage: string | null;
}

/** An esign_template_versions row. */
export interface EsignTemplateVersionRecord extends EsignTemplateContent {
  version: number;
  savedAt: Date;
  savedByUserId: string;
  /** What changed, in the saver's words. */
  note: string | null;
}

/** What the list asks for. */
export interface EsignTemplateFilter {
  /** Null: every template of the firm (Owner, Admin). A member's id: FIRM ones and their own. */
  visibleTo: string | null;
  /** Only archived ones, or only active ones. */
  archived: boolean;
  /** Case-insensitive substring of the name (Prisma: ILIKE with %, _ and \ escaped). */
  search?: string;
}

/** A list row: the template and its newest version. */
export interface EsignListedTemplate {
  template: EsignTemplateRecord;
  current: EsignTemplateVersionRecord;
}

/** What PATCH may change. */
export type EsignTemplatePatch = Partial<
  Pick<EsignTemplateRecord, 'name' | 'description' | 'visibility'>
>;

export interface EsignTemplateRepository {
  /** The matching templates with their newest version, by updatedAt descending. */
  list(businessId: string, filter: EsignTemplateFilter): Promise<EsignListedTemplate[]>;
  /** Null when the firm has no such template (another firm's id included). */
  find(businessId: string, id: string): Promise<EsignTemplateRecord | null>;
  /** One version of the firm's template; null when there is none. */
  version(
    businessId: string,
    id: string,
    version: number,
  ): Promise<EsignTemplateVersionRecord | null>;
  // The writes below lock the template row (FOR UPDATE) and apply only while it is not archived
  // and its updatedAt is still `readAt`; otherwise they answer null and write nothing. Each
  // answers the template as written.
  /**
   * NAME_TAKEN (nothing written) when another active template of the firm has the name, compared
   * case-insensitively (a unique index on business_id, lower(name) where archived_at is null).
   */
  update(
    businessId: string,
    id: string,
    patch: EsignTemplatePatch,
    readAt: Date,
  ): Promise<EsignTemplateRecord | 'NAME_TAKEN' | null>;
  /** archivedAt = now: it can't be used or changed again; requests made from it keep their copy. */
  archive(businessId: string, id: string, readAt: Date): Promise<EsignTemplateRecord | null>;
}

export const TEMPLATE_REPOSITORY = Symbol('ESIGN_TEMPLATE_REPOSITORY');
