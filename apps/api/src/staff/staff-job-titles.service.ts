import { Inject, Injectable } from '@nestjs/common';
import { type Database, databaseErrorCode, type TxClient } from '@firmivra/db';
import type { StaffJobTitle } from '@firmivra/types';
import type { z } from 'zod';
import { AuditService } from '../audit/audit.service.js';
import { DATABASE } from '../database/database.module.js';
import { notFound } from '../workspaces/common.js';
import type { SaveStaffJobTitleBody } from './staff-input.js';
import { mapStaffDbError, requireManager, type StaffActor, staffConflict } from './staff.common.js';

type Out<S extends z.ZodType> = z.output<S>;
type Row = {
  id: string;
  name: string;
  archivedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

const SELECT = { id: true, name: true, archivedAt: true, createdAt: true, updatedAt: true };

const exists = () =>
  staffConflict('JOB_TITLE_EXISTS', 'Your firm already has a job title with this name');
const key = (name: string) => name.trim().toLowerCase();

/**
 * Staff Settings > Offices & Job Titles (Octavia's SM3 and SM11): the firm's saved job titles
 * (staff_job_titles). Owner and Admin add, rename, archive and restore; nothing is deleted. A
 * staff record keeps its own title text, so no change here touches a record. Names are unique
 * among the live titles, ignoring letter case (the database's index too). Audit rows hold no name.
 */
@Injectable()
export class StaffJobTitlesService {
  constructor(
    @Inject(DATABASE) private readonly database: Database,
    private readonly audit: AuditService,
  ) {}

  private inFirm<T>(actor: StaffActor, fn: (tx: TxClient) => Promise<T>): Promise<T> {
    return this.database.withScope({ kind: 'business', businessId: actor.businessId }, fn);
  }

  /** How many staff records carry each title, by its lower-case name. */
  private async counts(tx: TxClient, businessId: string): Promise<Map<string, number>> {
    const rows = await tx.$queryRaw<{ title: string; n: bigint }[]>`
      SELECT lower(btrim(job_title)) AS title, count(*) AS n
        FROM memberships
       WHERE business_id = ${businessId}::uuid AND job_title IS NOT NULL
       GROUP BY 1`;
    return new Map(rows.map((r) => [r.title, Number(r.n)]));
  }

  private view(row: Row, counts: Map<string, number>): StaffJobTitle {
    return {
      id: row.id,
      name: row.name,
      staffCount: counts.get(key(row.name)) ?? 0,
      archivedAt: row.archivedAt?.toISOString() ?? null,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }

  private async one(tx: TxClient, businessId: string, row: Row): Promise<StaffJobTitle> {
    return this.view(row, await this.counts(tx, businessId));
  }

  /** A live title with this name, ignoring letter case, other than `except`. */
  private async taken(tx: TxClient, businessId: string, name: string, except?: string) {
    const found = await tx.staffJobTitle.findFirst({
      where: {
        businessId,
        archivedAt: null,
        name: { equals: name, mode: 'insensitive' },
        ...(except ? { id: { not: except } } : {}),
      },
      select: { id: true },
    });
    return found !== null;
  }

  private async find(tx: TxClient, businessId: string, id: string): Promise<Row> {
    const row = await tx.staffJobTitle.findFirst({ where: { businessId, id }, select: SELECT });
    if (!row) throw notFound();
    return row;
  }

  list(actor: StaffActor, includeArchived: boolean): Promise<StaffJobTitle[]> {
    return this.inFirm(actor, async (tx) => {
      const { businessId } = actor;
      const [rows, counts] = await Promise.all([
        tx.staffJobTitle.findMany({
          where: { businessId, ...(includeArchived ? {} : { archivedAt: null }) },
          select: SELECT,
        }),
        this.counts(tx, businessId),
      ]);
      const byName = (a: Row, b: Row) =>
        a.name.localeCompare(b.name, 'en', { sensitivity: 'base' }) || a.id.localeCompare(b.id);
      return [
        ...rows.filter((r) => !r.archivedAt).sort(byName),
        ...rows.filter((r) => r.archivedAt).sort(byName),
      ].map((r) => this.view(r, counts));
    });
  }

  private async change<T>(actor: StaffActor, fn: (tx: TxClient) => Promise<T>): Promise<T> {
    try {
      return await this.inFirm(actor, async (tx) => {
        await requireManager(tx, actor);
        return fn(tx);
      });
    } catch (e) {
      // Two saves of the same name at once: the database's unique index refuses the second.
      const code = databaseErrorCode(e) ?? (e as { code?: unknown } | null)?.code;
      if (code === 'P2002' || code === '23505') throw exists();
      throw mapStaffDbError(e);
    }
  }

  create(actor: StaffActor, body: Out<typeof SaveStaffJobTitleBody>): Promise<StaffJobTitle> {
    const { businessId } = actor;
    return this.change(actor, async (tx) => {
      if (await this.taken(tx, businessId, body.name)) throw exists();
      const row = await tx.staffJobTitle.create({
        data: { businessId, name: body.name, createdByUserId: actor.userId },
        select: SELECT,
      });
      await this.audit.logIn(
        tx,
        'staff_job_title.created',
        { type: 'staff_job_title', id: row.id },
        undefined,
        { businessId },
      );
      return this.one(tx, businessId, row);
    });
  }

  rename(
    actor: StaffActor,
    id: string,
    body: Out<typeof SaveStaffJobTitleBody>,
  ): Promise<StaffJobTitle> {
    const { businessId } = actor;
    return this.change(actor, async (tx) => {
      const row = await this.find(tx, businessId, id);
      if (row.archivedAt)
        throw staffConflict('JOB_TITLE_ARCHIVED', 'Restore this job title before renaming it');
      if (row.name === body.name) return this.one(tx, businessId, row);
      if (await this.taken(tx, businessId, body.name, id)) throw exists();
      const saved = await tx.staffJobTitle.update({
        where: { id },
        data: { name: body.name },
        select: SELECT,
      });
      await this.audit.logIn(
        tx,
        'staff_job_title.renamed',
        { type: 'staff_job_title', id },
        undefined,
        { businessId },
      );
      return this.one(tx, businessId, saved);
    });
  }

  archive(actor: StaffActor, id: string): Promise<StaffJobTitle> {
    const { businessId } = actor;
    return this.change(actor, async (tx) => {
      const row = await this.find(tx, businessId, id);
      if (row.archivedAt) return this.one(tx, businessId, row);
      const saved = await tx.staffJobTitle.update({
        where: { id },
        data: { archivedAt: new Date() },
        select: SELECT,
      });
      await this.audit.logIn(
        tx,
        'staff_job_title.archived',
        { type: 'staff_job_title', id },
        undefined,
        { businessId },
      );
      return this.one(tx, businessId, saved);
    });
  }

  restore(actor: StaffActor, id: string): Promise<StaffJobTitle> {
    const { businessId } = actor;
    return this.change(actor, async (tx) => {
      const row = await this.find(tx, businessId, id);
      if (!row.archivedAt) return this.one(tx, businessId, row);
      if (await this.taken(tx, businessId, row.name, id)) throw exists();
      const saved = await tx.staffJobTitle.update({
        where: { id },
        data: { archivedAt: null },
        select: SELECT,
      });
      await this.audit.logIn(
        tx,
        'staff_job_title.restored',
        { type: 'staff_job_title', id },
        undefined,
        { businessId },
      );
      return this.one(tx, businessId, saved);
    });
  }
}
