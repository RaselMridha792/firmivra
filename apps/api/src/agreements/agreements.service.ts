import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { Database, TxClient } from '@firmivra/db';
import {
  type AcknowledgmentView,
  type AgreementPdf,
  type AgreementVersion,
  type AgreementVersionSummary,
  type CreateAgreementRequest,
  type FirmAgreementDetail,
  type FirmAgreementList,
  type FirmAgreementSummary,
  type IntakeAgreement,
  type IntakeAgreementBlock,
  type IntakeFormKey,
  MAX_SERVICE_AGREEMENTS,
  type PublishAgreementVersionRequest,
} from '@firmivra/types';
import { z } from 'zod';
import { AuditService } from '../audit/audit.service.js';
import { PortalInfoService } from '../client-auth/portal-info.controller.js';
import { DATABASE } from '../database/database.module.js';
import { day, isUniqueViolation, memberNames, memberRef } from '../workspaces/common.js';

/**
 * AGREEMENT_PDF_REQUIRED: every version needs a CLEAN PDF original (Rasel's decision 3, Oct 8).
 * Off by default until a firm can upload and scan a PDF on dev end to end (the agreement editor's
 * upload and the scan); then the default goes back to true. Empty counts as unset.
 */
export interface AgreementsConfig {
  pdfRequired: boolean;
}
export const AGREEMENTS_CONFIG = Symbol('AGREEMENTS_CONFIG');
export function agreementsConfig(env: NodeJS.ProcessEnv = process.env): AgreementsConfig {
  const raw = env['AGREEMENT_PDF_REQUIRED'];
  const flag = z
    .enum(['true', 'false'])
    .default('false')
    .safeParse(raw === '' ? undefined : raw);
  if (!flag.success) throw new Error('AGREEMENT_PDF_REQUIRED must be "true" or "false"');
  return { pdfRequired: flag.data === 'true' };
}

const notFound = () => new NotFoundException({ code: 'NOT_FOUND', message: 'Not found' });
const conflict = (code: string, message: string) => new ConflictException({ code, message });

const fileSelect = { id: true, fileName: true, sizeBytes: true, sha256: true } as const;
/** What lists and histories show: no text, acknowledgments or hash. */
const versionSummarySelect = {
  version: true,
  title: true,
  effectiveDate: true,
  publishedAt: true,
  publishedByUserId: true,
  pdfFile: { select: fileSelect },
} as const;
const versionSelect = {
  ...versionSummarySelect,
  id: true,
  agreementId: true,
  bodyMarkdown: true,
  bodySha256: true,
  acknowledgments: true,
} as const;
const agreementSelect = {
  id: true,
  scope: true,
  sortOrder: true,
  createdAt: true,
  archivedAt: true,
  service: { select: { id: true, name: true } },
  _count: { select: { versions: true } },
  versions: { orderBy: { version: 'desc' }, take: 1, select: versionSummarySelect },
} as const;

type VersionSummaryRow = {
  version: number;
  title: string;
  effectiveDate: Date | null;
  publishedAt: Date;
  publishedByUserId: string;
  pdfFile: { id: string; fileName: string; sizeBytes: number; sha256: string } | null;
};
type VersionRow = VersionSummaryRow & {
  agreementId: string;
  bodyMarkdown: string;
  bodySha256: string;
  acknowledgments: unknown;
};
type AgreementRow = {
  id: string;
  scope: 'ALL_INTAKES' | 'SERVICE';
  sortOrder: number;
  createdAt: Date;
  archivedAt: Date | null;
  service: { id: string; name: string } | null;
  _count: { versions: number };
  versions: VersionSummaryRow[];
};

const pdfOf = (row: VersionSummaryRow): AgreementPdf | null =>
  row.pdfFile && {
    fileId: row.pdfFile.id,
    fileName: row.pdfFile.fileName,
    sizeBytes: row.pdfFile.sizeBytes,
    sha256: row.pdfFile.sha256,
  };
/** The database checked the shape (app_valid_acknowledgments); only the four keys go out. */
const acknowledgmentsOf = (value: unknown): AcknowledgmentView[] =>
  (value as AcknowledgmentView[]).map(({ key, label, text, required }) => ({
    key,
    label,
    text,
    required,
  }));

function summaryOf(row: VersionSummaryRow, names: Map<string, string>): AgreementVersionSummary {
  return {
    version: row.version,
    title: row.title,
    effectiveDate: day(row.effectiveDate),
    publishedAt: row.publishedAt.toISOString(),
    publishedBy: memberRef(names, row.publishedByUserId),
    pdf: pdfOf(row),
  };
}

function versionOf(row: VersionRow, names: Map<string, string>): AgreementVersion {
  return {
    ...summaryOf(row, names),
    agreementId: row.agreementId,
    bodyMarkdown: row.bodyMarkdown,
    bodySha256: row.bodySha256,
    acknowledgments: acknowledgmentsOf(row.acknowledgments),
  };
}

function agreementOf(row: AgreementRow, names: Map<string, string>): FirmAgreementSummary {
  const current = row.versions[0];
  return {
    id: row.id,
    scope: row.scope,
    service: row.service,
    sortOrder: row.sortOrder,
    archivedAt: row.archivedAt?.toISOString() ?? null,
    current: current ? summaryOf(current, names) : null,
    versionCount: row._count.versions,
  };
}

/** The firm-wide agreement first, then service agreements by sort order, creation, then id. */
const byPlace = (a: AgreementRow, b: AgreementRow) =>
  Number(a.scope === 'SERVICE') - Number(b.scope === 'SERVICE') ||
  a.sortOrder - b.sortOrder ||
  a.createdAt.getTime() - b.createdAt.getTime() ||
  (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

/**
 * The firm's intake agreements (docs/api/agreements.yaml). Versions are insert-only; the
 * database computes body_sha256, refuses a PDF that isn't CLEAN and numbers versions max+1.
 * Audit rows carry ids and version numbers, never the text.
 */
@Injectable()
export class AgreementsService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    @Inject(AGREEMENTS_CONFIG) private readonly config: AgreementsConfig,
    private readonly audit: AuditService,
    private readonly portal: PortalInfoService,
  ) {}

  private inFirm<T>(businessId: string, fn: (tx: TxClient) => Promise<T>): Promise<T> {
    return this.db.withScope({ kind: 'business', businessId }, fn);
  }

  async list(businessId: string): Promise<FirmAgreementList> {
    return this.inFirm(businessId, async (tx) => {
      const rows = (await tx.firmAgreement.findMany({ select: agreementSelect })).sort(byPlace);
      const names = await memberNames(
        tx,
        businessId,
        rows.flatMap((r) => r.versions.map((v) => v.publishedByUserId)),
      );
      const services = await tx.service.findMany({
        where: { archivedAt: null },
        orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }],
        select: { id: true, name: true, kind: true },
      });
      return { items: rows.map((r) => agreementOf(r, names)), services };
    });
  }

  async get(businessId: string, agreementId: string): Promise<FirmAgreementDetail> {
    return this.inFirm(businessId, async (tx) => {
      const row = await tx.firmAgreement.findUnique({
        where: { id: agreementId },
        select: {
          ...agreementSelect,
          versions: { orderBy: { version: 'desc' }, select: versionSummarySelect },
        },
      });
      if (!row) throw notFound();
      const names = await memberNames(
        tx,
        businessId,
        row.versions.map((v) => v.publishedByUserId),
      );
      return { ...agreementOf(row, names), versions: row.versions.map((v) => summaryOf(v, names)) };
    });
  }

  async getVersion(
    businessId: string,
    agreementId: string,
    version: number,
  ): Promise<AgreementVersion> {
    return this.inFirm(businessId, async (tx) => {
      const row = await tx.firmAgreementVersion.findFirst({
        where: { agreementId, version },
        select: versionSelect,
      });
      if (!row) throw notFound();
      return versionOf(row, await memberNames(tx, businessId, [row.publishedByUserId]));
    });
  }

  async create(
    businessId: string,
    userId: string,
    body: CreateAgreementRequest,
  ): Promise<FirmAgreementSummary> {
    const firmWideExists = () =>
      conflict('FIRM_WIDE_EXISTS', 'The firm already has a firm-wide agreement');
    const row = await this.inFirm(businessId, async (tx) => {
      // One create at a time per firm (so per service too): two creates can't both pass the
      // firm-wide check or the per-service count below.
      const key = `firm_agreements:${businessId}`;
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${key}, 0))`;
      if (body.scope === 'ALL_INTAKES') {
        const open = await tx.firmAgreement.count({
          where: { scope: 'ALL_INTAKES', archivedAt: null },
        });
        if (open > 0) throw firmWideExists();
      } else {
        if (!body.serviceId) throw notFound();
        const service = await tx.service.findFirst({
          where: { id: body.serviceId, archivedAt: null },
          select: { id: true },
        });
        if (!service) throw notFound();
        const open = await tx.firmAgreement.count({
          where: { scope: 'SERVICE', serviceId: service.id, archivedAt: null },
        });
        if (open >= MAX_SERVICE_AGREEMENTS) {
          throw conflict(
            'SERVICE_AGREEMENT_LIMIT',
            `This service already has ${MAX_SERVICE_AGREEMENTS} agreements`,
          );
        }
      }
      let created;
      try {
        // sortOrder stays 0: there is no reorder call yet, so creation order decides.
        created = await tx.firmAgreement.create({
          data: {
            businessId,
            scope: body.scope,
            serviceId: body.scope === 'SERVICE' ? body.serviceId : null,
            createdByUserId: userId,
          },
          select: agreementSelect,
        });
      } catch (error) {
        if (isUniqueViolation(error)) throw firmWideExists();
        throw error;
      }
      await this.audit.logIn(
        tx,
        'agreement.created',
        { type: 'firm_agreement', id: created.id },
        { scope: created.scope, serviceId: created.service?.id ?? null },
      );
      return created;
    });
    return agreementOf(row, new Map());
  }

  async publish(
    businessId: string,
    userId: string,
    agreementId: string,
    body: z.output<typeof PublishAgreementVersionRequest>,
  ): Promise<AgreementVersion> {
    const row = await this.inFirm(businessId, async (tx) => {
      // The series row is locked, so two publishers get VERSION_CONFLICT, never two versions.
      const [series] = await tx.$queryRaw<{ scope: string; archived_at: Date | null }[]>`
        SELECT scope::text, archived_at FROM firm_agreements WHERE id = ${agreementId}::uuid
        FOR NO KEY UPDATE`;
      if (!series) throw notFound();
      if (series.archived_at) {
        throw conflict('AGREEMENT_ARCHIVED', 'This agreement is archived');
      }
      const last = await tx.firmAgreementVersion.findFirst({
        where: { agreementId },
        orderBy: { version: 'desc' },
        select: { version: true },
      });
      if ((last?.version ?? null) !== body.expectedCurrentVersion) {
        throw conflict('VERSION_CONFLICT', 'Someone published a newer version');
      }
      if (series.scope === 'ALL_INTAKES' && !body.acknowledgments.some((a) => a.required)) {
        throw new BadRequestException({
          code: 'VALIDATION_FAILED',
          message: 'The firm-wide agreement needs at least one required acknowledgment',
          details: [
            {
              path: 'acknowledgments',
              message: 'The firm-wide agreement needs at least one required acknowledgment',
            },
          ],
        });
      }
      const pdf = await this.cleanPdf(tx, body.pdfFileId ?? null);
      const created = await tx.firmAgreementVersion.create({
        data: {
          businessId,
          agreementId,
          version: (last?.version ?? 0) + 1,
          title: body.title,
          bodyMarkdown: body.bodyMarkdown,
          acknowledgments: body.acknowledgments,
          pdfFileId: pdf?.id ?? null,
          pdfSha256: pdf?.sha256 ?? null,
          effectiveDate: body.effectiveDate ? new Date(`${body.effectiveDate}T00:00:00Z`) : null,
          publishedByUserId: userId,
        },
        select: versionSelect,
      });
      await this.audit.logIn(
        tx,
        'agreement.version_published',
        { type: 'firm_agreement', id: agreementId },
        { version: created.version, pdfFileId: created.pdfFile?.id ?? null },
      );
      return created;
    });
    return versionOf(
      row,
      await this.inFirm(businessId, (tx) => memberNames(tx, businessId, [userId])),
    );
  }

  async archive(businessId: string, agreementId: string): Promise<FirmAgreementSummary> {
    return this.inFirm(businessId, async (tx) => {
      const found = await tx.firmAgreement.findUnique({
        where: { id: agreementId },
        select: { scope: true },
      });
      if (!found) throw notFound();
      if (found.scope === 'ALL_INTAKES') {
        throw conflict('FIRM_WIDE_REQUIRED', 'The firm-wide agreement can’t be archived');
      }
      const { count } = await tx.firmAgreement.updateMany({
        where: { id: agreementId, archivedAt: null },
        data: { archivedAt: new Date() },
      });
      if (count > 0) {
        await this.audit.logIn(tx, 'agreement.archived', {
          type: 'firm_agreement',
          id: agreementId,
        });
      }
      const updated = await tx.firmAgreement.findUniqueOrThrow({
        where: { id: agreementId },
        select: agreementSelect,
      });
      const names = await memberNames(
        tx,
        businessId,
        updated.versions.map((v) => v.publishedByUserId),
      );
      return agreementOf(updated, names);
    });
  }

  /**
   * Begin Online's block for a form: the firm's unarchived service of that kind, then the
   * firm-wide agreement's current version and the service's. Unknown or inactive firm, or no
   * such service: 404. `legal` only when both Terms and Privacy are published.
   */
  async intakeBlock(firmSlug: string, form: IntakeFormKey): Promise<IntakeAgreementBlock> {
    const firm = await this.portal.activeFirm(firmSlug);
    const [block, terms, privacy] = await Promise.all([
      this.inFirm(firm.id, async (tx) =>
        currentAgreements(tx, (await beginOnlineService(tx, form)).id),
      ),
      this.portal.currentVersion(firm.id, 'TERMS'),
      this.portal.currentVersion(firm.id, 'PRIVACY'),
    ]);
    const { versionIds: _ids, ...shown } = block;
    return {
      ...shown,
      legal:
        terms && privacy
          ? { terms: { version: terms.version }, privacy: { version: privacy.version } }
          : null,
    };
  }

  /**
   * The portal intake's block: the signed-in client's intake (theirs through its engagement;
   * anything else 404), resolved from the intake's form. `legal` is null: the client accepted
   * Terms and Privacy at sign-up.
   */
  async myIntakeBlock(
    businessId: string,
    clientAccountId: string,
    intakeId: string,
  ): Promise<IntakeAgreementBlock> {
    const block = await this.inFirm(businessId, async (tx) => {
      const account = await tx.clientAccount.findFirst({
        where: { businessId, id: clientAccountId },
        select: { clientId: true },
      });
      if (!account?.clientId) throw notFound();
      const intake = await tx.intake.findFirst({
        where: { id: intakeId, engagement: { clientId: account.clientId } },
        select: { form: { select: { serviceId: true } } },
      });
      if (!intake) throw notFound();
      return currentAgreements(tx, intake.form.serviceId);
    });
    await this.audit.log('portal.intake_agreements_viewed', { type: 'intake', id: intakeId });
    const { versionIds: _ids, ...shown } = block;
    return { ...shown, legal: null };
  }

  /** The file a version links, checked: none (PDF_REQUIRED when on), not found, or not CLEAN. */
  private async cleanPdf(tx: TxClient, fileId: string | null) {
    if (!fileId) {
      if (this.config.pdfRequired) throw conflict('PDF_REQUIRED', 'Upload the PDF original first');
      return null;
    }
    const file = await tx.firmAgreementFile.findUnique({
      where: { id: fileId },
      select: { id: true, sha256: true, scanStatus: true },
    });
    if (!file) throw notFound();
    if (file.scanStatus === 'PENDING') throw conflict('FILE_NOT_READY', 'Still being checked');
    if (file.scanStatus !== 'CLEAN') throw conflict('FILE_BLOCKED', 'The file can’t be used');
    return file;
  }
}

/**
 * The firm's Begin Online service for a form: its unarchived service of that kind marked
 * `begin_online` (at most one, by R0's unique index); none answers 404. Runs in the firm's scope.
 * Begin Online's submit resolves its service only through this, so the block and the signature
 * always agree.
 */
export async function beginOnlineService(tx: TxClient, form: IntakeFormKey) {
  const service = await tx.service.findFirst({
    where: { kind: form, archivedAt: null, beginOnline: true },
    select: { id: true },
  });
  if (!service) throw notFound();
  return service;
}

/**
 * The current versions a signer must sign: the open firm-wide agreement, then the service's open,
 * published agreements by sort order, creation, then id. The caller resolves the service (Begin
 * Online's form, or the intake's form). Shared with IntakeSignaturesService, which reads it under
 * lock.
 */
export async function currentAgreements(
  tx: TxClient,
  serviceId: string | null | undefined,
): Promise<Omit<IntakeAgreementBlock, 'legal'> & { versionIds: Map<string, string> }> {
  const rows = await tx.firmAgreement.findMany({
    where: {
      archivedAt: null,
      OR: [{ scope: 'ALL_INTAKES' }, ...(serviceId ? [{ serviceId }] : [])],
    },
    select: {
      ...agreementSelect,
      versions: { orderBy: { version: 'desc' }, take: 1, select: versionSelect },
    },
  });
  const versionIds = new Map<string, string>();
  const agreements: IntakeAgreement[] = [];
  for (const row of rows.sort(byPlace)) {
    const v = row.versions[0];
    if (!v) continue;
    versionIds.set(row.id, v.id);
    agreements.push({
      agreementId: row.id,
      scope: row.scope,
      version: v.version,
      title: v.title,
      effectiveDate: day(v.effectiveDate),
      publishedAt: v.publishedAt.toISOString(),
      bodyMarkdown: v.bodyMarkdown,
      bodySha256: v.bodySha256,
      acknowledgments: acknowledgmentsOf(v.acknowledgments),
      pdf: {
        // A version links only a CLEAN file (the versions trigger) and a scan result never
        // changes once set, so a linked file stays downloadable unless its bytes change.
        available: v.pdfFile !== null,
        sha256: v.pdfFile?.sha256 ?? null,
        fileName: v.pdfFile?.fileName ?? null,
        sizeBytes: v.pdfFile?.sizeBytes ?? null,
      },
    });
  }
  const ready = agreements[0]?.scope === 'ALL_INTAKES';
  return { ready, agreements: ready ? agreements : [], versionIds };
}
