import { Inject, Injectable } from '@nestjs/common';
import type { Database, Prisma, TxClient } from '@firmivra/db';
import {
  type MyReport,
  type MyReportList,
  type OkResponse,
  type Report,
  type ReportData,
  type ReportList,
  type ReportStatus,
  REPORT_KINDS,
} from '@firmivra/types';
import type { z } from 'zod';
import { AuditService } from '../audit/audit.service.js';
import type { ClientsActor } from '../clients/clients.service.js';
import { DATABASE } from '../database/database.module.js';
import {
  conflict,
  isForeignKeyViolation,
  lockClient,
  memberNames,
  memberRef,
  notFound,
  sentFields,
} from './common.js';
import type {
  CreateReportBody,
  MyReportsListQuery,
  ReportsListQuery,
  UpdateReportBody,
} from './input.js';
import { decodeTimeCursor, encodeTimeCursor, type TimeCursor } from './paging.js';
import { findWorkspace, workspaceKindOf } from './workspaces.service.js';

type ListQuery = z.output<typeof ReportsListQuery>;
type MineQuery = z.output<typeof MyReportsListQuery>;
type CreateBody = z.output<typeof CreateReportBody>;
type UpdateBody = z.output<typeof UpdateReportBody>;
type DataInput = NonNullable<CreateBody['data']>;

const engagementClosed = () =>
  conflict('ENGAGEMENT_CLOSED', 'This service is closed; its reports can no longer change');
const documentMismatch = () =>
  conflict('DOCUMENT_MISMATCH', 'The document is not from this service');
const internalDocument = () =>
  conflict('INTERNAL_DOCUMENT', 'This document is firm-only; attach one the client may see');
const wrongKind = () =>
  conflict('WRONG_REPORT_KIND', 'That report kind does not belong to this workspace');
const wasPublished = () =>
  conflict('REPORT_WAS_PUBLISHED', 'A report that was published cannot be deleted; unpublish it');

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

/** The stored figures as the contract shows them; a report saved without any reads as empty. */
export function readReportData(value: unknown): ReportData {
  const data = isRecord(value) ? value : {};
  const lines = Array.isArray(data['lines']) ? data['lines'].filter(isRecord) : [];
  return {
    summary: typeof data['summary'] === 'string' ? data['summary'] : null,
    lines: lines.map((line) => ({
      label: typeof line['label'] === 'string' ? line['label'] : '',
      amountCents: Number.isSafeInteger(line['amountCents'])
        ? (line['amountCents'] as number)
        : null,
      note: typeof line['note'] === 'string' ? line['note'] : null,
    })),
  };
}

/** The figures to store: exactly the contract's fields, nothing else. */
export const writeReportData = (data: DataInput | undefined): Prisma.InputJsonObject => ({
  summary: data?.summary ?? null,
  lines: (data?.lines ?? []).map((l) => ({
    label: l.label,
    amountCents: l.amountCents,
    note: l.note ?? null,
  })),
});

/** After the cursor in a newest-first list: an earlier time, or the same and a smaller id. */
function before(
  field: 'createdAt' | 'publishedAt',
  c: TimeCursor | undefined,
): Prisma.EngagementReportWhereInput {
  if (!c) return {};
  return field === 'createdAt'
    ? { OR: [{ createdAt: { lt: c.at } }, { createdAt: c.at, id: { lt: c.id } }] }
    : { OR: [{ publishedAt: { lt: c.at } }, { publishedAt: c.at, id: { lt: c.id } }] };
}

const select = {
  id: true,
  engagementId: true,
  kind: true,
  title: true,
  periodLabel: true,
  status: true,
  data: true,
  documentId: true,
  publishedAt: true,
  firstPublishedAt: true,
  createdByUserId: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.EngagementReportSelect;
type Row = Prisma.EngagementReportGetPayload<{ select: typeof select }>;

function toReport(row: Row, names: Map<string, string>): Report {
  return {
    id: row.id,
    engagementId: row.engagementId,
    kind: row.kind,
    title: row.title,
    periodLabel: row.periodLabel,
    status: row.status,
    data: readReportData(row.data),
    documentId: row.documentId,
    publishedAt: row.publishedAt?.toISOString() ?? null,
    firstPublishedAt: row.firstPublishedAt?.toISOString() ?? null,
    createdBy: memberRef(names, row.createdByUserId),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/** The report as it was when locked, for the rules of each change and the audit row. */
interface Locked {
  engagementId: string;
  clientId: string;
  status: ReportStatus;
  documentId: string | null;
  firstPublishedAt: Date | null;
}

const UPDATE_FIELDS = ['title', 'periodLabel', 'data', 'documentId'] as const;

/**
 * Workspace reports (R12 step 6; contract in packages/types/src/workspaces): drafts, edits,
 * publish and unpublish by whoever sees the workspace (Rasel, Oct 8, q6), delete only if never
 * published. Changes need an open engagement (PENDING or ACTIVE) except unpublish and deleting a
 * never-published draft (q8). The attached file is one of the engagement's documents and never an
 * INTERNAL one, checked on attach and again on publish. The client reads published reports in
 * My Services. Audited with ids, kinds, counts and field names only, never a title, text or
 * amount.
 */
@Injectable()
export class ReportsService {
  constructor(
    @Inject(DATABASE) private readonly database: Database,
    private readonly audit: AuditService,
  ) {}

  private inFirm<T>(businessId: string, fn: (tx: TxClient) => Promise<T>): Promise<T> {
    return this.database.withScope({ kind: 'business', businessId }, fn);
  }

  /** One page of a workspace's reports, newest first. A bad cursor is 400 before a 404. */
  async list(
    businessId: string,
    actor: ClientsActor,
    engagementId: string,
    q: ListQuery,
  ): Promise<ReportList> {
    const after = q.cursor ? decodeTimeCursor(q.cursor) : undefined;
    const { rows, names, workspace } = await this.inFirm(businessId, async (tx) => {
      const workspace = await findWorkspace(tx, businessId, actor, engagementId);
      const rows = await tx.engagementReport.findMany({
        where: {
          AND: [
            { businessId, engagementId: workspace.id },
            q.status ? { status: q.status } : {},
            before('createdAt', after),
          ],
        },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: q.limit + 1,
        select,
      });
      const names = await memberNames(
        tx,
        businessId,
        rows.slice(0, q.limit).map((r) => r.createdByUserId),
      );
      return { rows, names, workspace };
    });
    const page = rows.slice(0, q.limit);
    const last = page.at(-1);
    await this.audit.log(
      'reports.listed',
      { type: 'engagement', id: workspace.id },
      { clientId: workspace.clientId, count: page.length, filters: sentFields(q, ['status']) },
    );
    return {
      items: page.map((row) => toReport(row, names)),
      nextCursor:
        rows.length > q.limit && last
          ? encodeTimeCursor({ at: last.createdAt, id: last.id })
          : null,
    };
  }

  /** A new DRAFT whose kind fits the workspace (REPORT_KINDS). */
  async create(
    businessId: string,
    actor: ClientsActor,
    engagementId: string,
    body: CreateBody,
  ): Promise<Report> {
    const { report, clientId } = await this.inFirm(businessId, async (tx) => {
      // The client first, then the engagement (requireOpen), as every change here and R10's
      // reassignment take them: who reaches the workspace (q5) holds until this commits.
      await this.lockClientOf(tx, businessId, engagementId);
      const workspace = await findWorkspace(tx, businessId, actor, engagementId);
      await this.requireOpen(tx, businessId, workspace.id);
      if (!REPORT_KINDS[workspace.kind].includes(body.kind)) throw wrongKind();
      if (body.documentId) await this.attachable(tx, businessId, workspace.id, body.documentId);
      const created = await tx.engagementReport.create({
        data: {
          businessId,
          engagementId: workspace.id,
          kind: body.kind,
          title: body.title,
          periodLabel: body.periodLabel ?? null,
          data: writeReportData(body.data),
          documentId: body.documentId ?? null,
          createdByUserId: actor.userId,
        },
        select: { id: true },
      });
      return {
        report: await this.read(tx, businessId, created.id),
        clientId: workspace.clientId,
      };
    }).catch(documentGone);
    await this.audit.log(
      'report.created',
      { type: 'report', id: report.id },
      {
        engagementId: report.engagementId,
        clientId,
        kind: report.kind,
        documentAttached: report.documentId !== null,
        lines: report.data.lines.length,
      },
    );
    return report;
  }

  /** Changes only what is sent; published reports too (the client sees the change at once). */
  async update(
    businessId: string,
    actor: ClientsActor,
    id: string,
    body: UpdateBody,
  ): Promise<Report> {
    const { report, was } = await this.inFirm(businessId, async (tx) => {
      const was = await this.lock(tx, businessId, actor, id);
      await this.requireOpen(tx, businessId, was.engagementId);
      if (body.documentId) {
        await this.attachable(tx, businessId, was.engagementId, body.documentId);
      }
      const data: Prisma.EngagementReportUncheckedUpdateInput = {};
      if (body.title !== undefined) data.title = body.title;
      if (body.periodLabel !== undefined) data.periodLabel = body.periodLabel;
      if (body.data !== undefined) data.data = writeReportData(body.data);
      if (body.documentId !== undefined) data.documentId = body.documentId;
      await tx.engagementReport.update({ where: { id }, data, select: { id: true } });
      return { report: await this.read(tx, businessId, id), was };
    }).catch(documentGone);
    await this.audit.log(
      'report.updated',
      { type: 'report', id: report.id },
      {
        engagementId: was.engagementId,
        clientId: was.clientId,
        status: was.status,
        fields: sentFields(body, UPDATE_FIELDS),
      },
    );
    return report;
  }

  /** The client sees it from now on. Publishing a published report changes nothing. */
  async publish(businessId: string, actor: ClientsActor, id: string): Promise<Report> {
    const { report, was } = await this.inFirm(businessId, async (tx) => {
      const was = await this.lock(tx, businessId, actor, id);
      await this.requireOpen(tx, businessId, was.engagementId);
      if (was.documentId) await this.attachable(tx, businessId, was.engagementId, was.documentId);
      if (was.status !== 'PUBLISHED') {
        // The database sets firstPublishedAt the first time.
        await tx.engagementReport.update({
          where: { id },
          data: { status: 'PUBLISHED', publishedAt: new Date() },
          select: { id: true },
        });
      }
      return { report: await this.read(tx, businessId, id), was };
    });
    if (was.status !== 'PUBLISHED') {
      await this.audit.log(
        'report.published',
        { type: 'report', id: report.id },
        {
          engagementId: was.engagementId,
          clientId: was.clientId,
          firstTime: was.firstPublishedAt === null,
        },
      );
    }
    return report;
  }

  /** Hides it from the client again; works on a closed engagement too. */
  async unpublish(businessId: string, actor: ClientsActor, id: string): Promise<Report> {
    const { report, was } = await this.inFirm(businessId, async (tx) => {
      const was = await this.lock(tx, businessId, actor, id);
      if (was.status === 'PUBLISHED') {
        await tx.engagementReport.update({
          where: { id },
          data: { status: 'DRAFT', publishedAt: null },
          select: { id: true },
        });
      }
      return { report: await this.read(tx, businessId, id), was };
    });
    if (was.status === 'PUBLISHED') {
      await this.audit.log(
        'report.unpublished',
        { type: 'report', id: report.id },
        { engagementId: was.engagementId, clientId: was.clientId },
      );
    }
    return report;
  }

  /**
   * Only a report that was never published (the client never saw it), on an open or closed
   * engagement. A report that was ever published is 409 REPORT_WAS_PUBLISHED: unpublish it.
   */
  async remove(businessId: string, actor: ClientsActor, id: string): Promise<OkResponse> {
    const was = await this.inFirm(businessId, async (tx) => {
      const was = await this.lock(tx, businessId, actor, id);
      if (was.firstPublishedAt !== null) throw wasPublished();
      // Row-level security deletes only never-published reports, whatever the API decides.
      const { count } = await tx.engagementReport.deleteMany({
        where: { businessId, id, firstPublishedAt: null },
      });
      if (count !== 1) throw notFound();
      return was;
    });
    await this.audit.log(
      'report.deleted',
      { type: 'report', id: id.toLowerCase() },
      { engagementId: was.engagementId, clientId: was.clientId },
    );
    return { ok: true };
  }

  /**
   * The signed-in client's published reports of one of their services, newest published first.
   * The client comes from the session, as in R10's My Services (any login of the client record:
   * primary, spouse or authorized); another client's service, or one of another firm, is 404.
   */
  async mine(
    businessId: string,
    clientAccountId: string,
    engagementId: string,
    q: MineQuery,
  ): Promise<MyReportList> {
    const after = q.cursor ? decodeTimeCursor(q.cursor) : undefined;
    const { rows, clientId, serviceId } = await this.inFirm(businessId, async (tx) => {
      const account = await tx.clientAccount.findFirst({
        where: { businessId, id: clientAccountId },
        select: { clientId: true },
      });
      if (!account?.clientId) throw notFound();
      const engagement = await tx.engagement.findFirst({
        where: { businessId, id: engagementId, clientId: account.clientId },
        select: { id: true, service: { select: { kind: true } } },
      });
      if (!engagement) throw notFound();
      // Their service without a workspace has no reports, whatever a row says (#109 review).
      if (!workspaceKindOf(engagement.service.kind)) {
        return { rows: [], clientId: account.clientId, serviceId: engagement.id };
      }
      const rows = await tx.engagementReport.findMany({
        where: {
          AND: [
            { businessId, engagementId: engagement.id, status: 'PUBLISHED' },
            before('publishedAt', after),
          ],
        },
        orderBy: [{ publishedAt: 'desc' }, { id: 'desc' }],
        take: q.limit + 1,
        select: {
          id: true,
          kind: true,
          title: true,
          periodLabel: true,
          data: true,
          documentId: true,
          publishedAt: true,
          document: { select: { direction: true } },
        },
      });
      return { rows, clientId: account.clientId, serviceId: engagement.id };
    });
    const page = rows.slice(0, q.limit);
    const last = page.at(-1);
    await this.audit.log(
      'portal.reports_viewed',
      { type: 'engagement', id: serviceId },
      { clientId, count: page.length },
    );
    return {
      items: page.map((row): MyReport => ({
        id: row.id,
        kind: row.kind,
        title: row.title,
        periodLabel: row.periodLabel,
        data: readReportData(row.data),
        // Never reachable (attach and publish refuse one), but a firm-only file never shows.
        documentId: row.document?.direction === 'INTERNAL' ? null : row.documentId,
        publishedAt: row.publishedAt?.toISOString() ?? null,
      })),
      nextCursor:
        rows.length > q.limit && last?.publishedAt
          ? encodeTimeCursor({ at: last.publishedAt, id: last.id })
          : null,
    };
  }

  /**
   * Locks the report for this change (one change of a report at a time) and checks that the
   * actor sees its workspace (a Bookkeeping or Tax Planning engagement; Staff: their client's);
   * else 404. Locks in one order, the client (FOR SHARE), then the report, then the engagement
   * (requireOpen), as tasks and R10's reassignment take them, so who reaches the workspace (q5)
   * holds until this change commits (#109 review). A report never changes engagement, nor an
   * engagement client, so they are read first without a lock.
   */
  private async lock(
    tx: TxClient,
    businessId: string,
    actor: ClientsActor,
    id: string,
  ): Promise<Locked> {
    const owner = await tx.engagementReport.findFirst({
      where: { businessId, id },
      select: { engagementId: true },
    });
    if (!owner) throw notFound();
    await this.lockClientOf(tx, businessId, owner.engagementId);
    const [locked] = await tx.$queryRaw<{ engagement_id: string }[]>`
      SELECT engagement_id::text AS engagement_id FROM engagement_reports
      WHERE business_id = ${businessId}::uuid AND id = ${id}::uuid
      FOR UPDATE`;
    if (!locked || locked.engagement_id !== owner.engagementId) throw notFound();
    const workspace = await findWorkspace(tx, businessId, actor, locked.engagement_id);
    const row = await tx.engagementReport.findFirst({
      where: { businessId, id },
      select: { status: true, documentId: true, firstPublishedAt: true },
    });
    if (!row) throw notFound();
    return { ...row, engagementId: workspace.id, clientId: workspace.clientId };
  }

  /** The engagement's client, locked FOR SHARE (404 for an engagement this firm doesn't have). */
  private async lockClientOf(tx: TxClient, businessId: string, engagementId: string) {
    const engagement = await tx.engagement.findFirst({
      where: { businessId, id: engagementId },
      select: { clientId: true },
    });
    if (!engagement || !(await lockClient(tx, businessId, engagement.clientId))) throw notFound();
  }

  /**
   * The engagement is open (PENDING or ACTIVE), and stays so until this change commits: FOR
   * SHARE makes a concurrent complete or cancel wait for it (or this read waits for theirs).
   */
  private async requireOpen(tx: TxClient, businessId: string, engagementId: string) {
    const [engagement] = await tx.$queryRaw<{ status: string }[]>`
      SELECT status::text AS status FROM engagements
      WHERE business_id = ${businessId}::uuid AND id = ${engagementId}::uuid
      FOR SHARE`;
    if (!engagement) throw notFound();
    if (engagement.status !== 'PENDING' && engagement.status !== 'ACTIVE') {
      throw engagementClosed();
    }
  }

  /**
   * The document belongs to this engagement (409 DOCUMENT_MISMATCH: another engagement's,
   * another firm's or none) and the client may see it (409 INTERNAL_DOCUMENT; a document's
   * direction never changes). A plain read: the reports' RESTRICT foreign key keeps an attached
   * document from being deleted, and attaching one takes its key lock through that check (a
   * document gone meanwhile is 409, documentGone). Locking it here, after the report, deadlocked
   * with a document delete, which takes the document first (#109 review).
   */
  private async attachable(
    tx: TxClient,
    businessId: string,
    engagementId: string,
    documentId: string,
  ) {
    const [document] = await tx.$queryRaw<{ direction: string }[]>`
      SELECT direction::text AS direction FROM documents
      WHERE business_id = ${businessId}::uuid AND engagement_id = ${engagementId}::uuid
        AND id = ${documentId}::uuid`;
    if (!document) throw documentMismatch();
    if (document.direction === 'INTERNAL') throw internalDocument();
  }

  private async read(tx: TxClient, businessId: string, id: string): Promise<Report> {
    const row = await tx.engagementReport.findFirst({ where: { businessId, id }, select });
    if (!row) throw notFound();
    return toReport(row, await memberNames(tx, businessId, [row.createdByUserId]));
  }
}

/** The attached document went away between the check and the write (foreign key). */
function documentGone(error: unknown): never {
  if (isForeignKeyViolation(error)) throw documentMismatch();
  throw error;
}
