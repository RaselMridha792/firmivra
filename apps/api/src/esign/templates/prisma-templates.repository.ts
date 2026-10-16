import { Inject, Injectable } from '@nestjs/common';
import type {
  Database,
  EsignTemplate as TemplateRow,
  EsignTemplateVersion as VersionRow,
  Prisma,
  TxClient,
} from '@firmivra/db';
import { databaseErrorCode } from '@firmivra/db';
import {
  EsignFieldValues,
  inFirm,
  InjectDatabase,
  insertDraft,
  nextActivity,
  REMINDERS,
} from '../requests/esign-prisma.js';
import { insensitive } from '../requests/prisma-esign.repository.js';
import type { EsignRequestRecord } from '../requests/esign.repository.js';
import type {
  EsignListedTemplate,
  EsignTemplateContent,
  EsignTemplateDraft,
  EsignTemplateFilter,
  EsignTemplatePatch,
  EsignTemplateRecord,
  EsignTemplateRepository,
  EsignTemplateVersionRecord,
  NewEsignTemplate,
} from './templates.repository.js';

const toTemplate = ({ businessId: _b, ...t }: TemplateRow): EsignTemplateRecord => t;

function toVersion(v: VersionRow): EsignTemplateVersionRecord {
  return {
    ...{ version: v.version, savedAt: v.savedAt, savedByUserId: v.savedByUserId, note: v.note },
    ...{ s3Key: v.s3Key, sha256: v.sha256, sizeBytes: v.sizeBytes },
    pageSizes: v.pageSizes as EsignTemplateContent['pageSizes'],
    roles: v.roles as EsignTemplateContent['roles'],
    fields: v.fields as EsignTemplateContent['fields'],
    ...{ routing: v.routing, expiryDays: v.expiryDays, expiryWarningDays: v.expiryWarningDays },
    reminders: {
      firstAfterDays: v.reminderFirstAfterDays,
      everyDays: v.reminderEveryDays,
      max: v.reminderMax,
    },
    ...{ emailSubject: v.emailSubject, emailMessage: v.emailMessage },
  };
}

const json = (v: unknown) => v as Prisma.InputJsonValue;
/** A version's columns (the JSON parts as stored). */
function versionColumns(c: EsignTemplateContent & { note: string | null }) {
  const { reminders, pageSizes, roles, fields, note, ...rest } = c;
  return {
    ...rest,
    ...REMINDERS({ reminders }),
    pageSizes: json(pageSizes),
    roles: json(roles),
    fields: json(fields),
    note: note?.trim() ? note : null,
  };
}

/** A unique violation: another active template of the firm has the name. */
const nameTaken = (error: unknown) => databaseErrorCode(error) === '23505';

/**
 * Firm Sign's templates in PostgreSQL (R13, r0_esign): esign_templates and its insert-only
 * versions, in the firm's scope. Writes lock the template row FOR UPDATE and apply only while
 * it is active and its updatedAt is still `readAt`; updatedAt moves strictly forward.
 */
@Injectable()
export class PrismaTemplateRepository implements EsignTemplateRepository {
  constructor(
    @InjectDatabase() private readonly database: Database,
    @Inject(EsignFieldValues) private readonly values: EsignFieldValues,
  ) {}

  private db(businessId: string) {
    return this.database.forBusiness(businessId);
  }

  async list(businessId: string, f: EsignTemplateFilter): Promise<EsignListedTemplate[]> {
    const rows = await this.db(businessId).esignTemplate.findMany({
      where: {
        archivedAt: f.archived ? { not: null } : null,
        ...(f.visibleTo !== null && {
          OR: [{ visibility: 'FIRM' }, { ownerUserId: f.visibleTo }],
        }),
        ...(f.search && { name: insensitive(f.search) }),
      },
      orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
      include: { versions: { orderBy: { version: 'desc' }, take: 1 } },
    });
    return rows.flatMap(({ versions, ...t }) =>
      versions[0] ? [{ template: toTemplate(t), current: toVersion(versions[0]) }] : [],
    );
  }

  async find(businessId: string, id: string): Promise<EsignTemplateRecord | null> {
    const row = await this.db(businessId).esignTemplate.findFirst({ where: { id } });
    return row && toTemplate(row);
  }

  async version(businessId: string, id: string, version: number) {
    const row = await this.db(businessId).esignTemplateVersion.findFirst({
      where: { templateId: id, version },
    });
    return row && toVersion(row);
  }

  async versions(businessId: string, id: string): Promise<EsignTemplateVersionRecord[]> {
    const rows = await this.db(businessId).esignTemplateVersion.findMany({
      where: { templateId: id },
      orderBy: { version: 'desc' },
    });
    return rows.map(toVersion);
  }

  /** A write under the template's lock, while it is active and unchanged since `readAt`. */
  private write(
    businessId: string,
    id: string,
    readAt: Date,
    data: (tx: TxClient, t: TemplateRow) => Promise<Prisma.EsignTemplateUpdateInput>,
  ): Promise<EsignTemplateRecord | null> {
    return inFirm(this.database, businessId, async (tx) => {
      const [locked] = await tx.$queryRaw<{ id: string }[]>`
        SELECT id FROM esign_templates WHERE id = ${id}::uuid FOR UPDATE`;
      const t = locked && (await tx.esignTemplate.findUniqueOrThrow({ where: { id } }));
      if (!t || t.archivedAt || t.updatedAt.getTime() !== readAt.getTime()) return null;
      const updatedAt = nextActivity(t.updatedAt);
      const row = await tx.esignTemplate.update({
        where: { id },
        data: { ...(await data(tx, t)), updatedAt },
      });
      return toTemplate(row);
    });
  }

  async update(businessId: string, id: string, patch: EsignTemplatePatch, readAt: Date) {
    try {
      return await this.write(businessId, id, readAt, () => Promise.resolve(patch));
    } catch (error) {
      if (nameTaken(error)) return 'NAME_TAKEN' as const;
      throw error;
    }
  }

  archive(businessId: string, id: string, readAt: Date) {
    return this.write(businessId, id, readAt, () => Promise.resolve({ archivedAt: new Date() }));
  }

  async create(
    businessId: string,
    template: NewEsignTemplate,
    first: EsignTemplateContent & { note: string | null },
  ): Promise<EsignTemplateRecord | 'NAME_TAKEN'> {
    try {
      return await inFirm(this.database, businessId, async (tx) => {
        const row = await tx.esignTemplate.create({ data: { ...template, businessId } });
        await tx.esignTemplateVersion.create({
          data: {
            ...versionColumns(first),
            ...{ businessId, templateId: row.id, version: 1 },
            savedByUserId: template.ownerUserId,
          },
        });
        return toTemplate(row);
      });
    } catch (error) {
      if (nameTaken(error)) return 'NAME_TAKEN';
      throw error;
    }
  }

  async createDraft(businessId: string, draft: EsignTemplateDraft): Promise<EsignRequestRecord> {
    const { record, parts, event } = draft;
    const sealed = await this.values.seal(businessId, parts.fields);
    return inFirm(this.database, businessId, (tx) =>
      insertDraft(tx, businessId, record, parts, sealed, event),
    );
  }

  addVersion(
    businessId: string,
    id: string,
    version: EsignTemplateContent & { note: string | null; savedByUserId: string },
    readAt: Date,
  ) {
    const { savedByUserId, ...content } = version;
    // The next version first: the database moves the template's version only to a saved one.
    return this.write(businessId, id, readAt, async (tx, t) => {
      await tx.esignTemplateVersion.create({
        data: {
          ...versionColumns(content),
          ...{ businessId, templateId: id, version: t.version + 1, savedByUserId },
        },
      });
      return { version: t.version + 1 };
    });
  }
}
