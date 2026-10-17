import { Inject, Injectable } from '@nestjs/common';
import type { Database, TxClient } from '@firmivra/db';
import type { TaskType } from '@firmivra/types';
import type { z } from 'zod';
import { AuditService } from '../audit/audit.service.js';
import { DATABASE } from '../database/database.module.js';
import { isUniqueViolation, notFound } from '../workspaces/common.js';
import { taskErrors } from './task-common.js';
import type { SaveTaskTypeRequest } from './task-input.js';

type Body = z.output<typeof SaveTaskTypeRequest>;

const toType = (t: {
  id: string;
  name: string;
  sortOrder: number;
  archivedAt: Date | null;
}): TaskType => ({
  id: t.id,
  name: t.name,
  sortOrder: t.sortOrder,
  archivedAt: t.archivedAt?.toISOString() ?? null,
});

/**
 * The firm's task types ("Bookkeeping", "Tax Prep"). Archived, never deleted; names are unique
 * ignoring case. Owner and Admin change them (the routes say so); everyone with the Tasks view
 * reads them (TaskReadService.types).
 */
@Injectable()
export class TaskTypesService {
  constructor(
    @Inject(DATABASE) private readonly database: Database,
    private readonly audit: AuditService,
  ) {}

  private inFirm<T>(businessId: string, fn: (tx: TxClient) => Promise<T>): Promise<T> {
    return this.database.withScope({ kind: 'business', businessId }, fn);
  }

  async create(businessId: string, body: Body): Promise<TaskType> {
    const row = await this.write(businessId, async (tx) => {
      await this.uniqueName(tx, businessId, body.name);
      const last = await tx.taskType.aggregate({
        where: { businessId },
        _max: { sortOrder: true },
      });
      return tx.taskType.create({
        data: { businessId, name: body.name, sortOrder: (last._max.sortOrder ?? -1) + 1 },
      });
    });
    await this.audit.log('task_type.created', { type: 'task_type', id: row.id });
    return toType(row);
  }

  async update(businessId: string, id: string, body: Body): Promise<TaskType> {
    const row = await this.write(businessId, async (tx) => {
      const cur = await tx.taskType.findFirst({ where: { businessId, id } });
      if (!cur) throw notFound();
      if (body.name !== cur.name) await this.uniqueName(tx, businessId, body.name, id);
      return tx.taskType.update({ where: { id }, data: { name: body.name } });
    });
    await this.audit.log('task_type.updated', { type: 'task_type', id: row.id });
    return toType(row);
  }

  archive(businessId: string, id: string) {
    return this.setArchived(businessId, id, true);
  }
  restore(businessId: string, id: string) {
    return this.setArchived(businessId, id, false);
  }

  private async setArchived(businessId: string, id: string, archive: boolean): Promise<TaskType> {
    const { row, changed } = await this.inFirm(businessId, async (tx) => {
      const cur = await tx.taskType.findFirst({ where: { businessId, id } });
      if (!cur) throw notFound();
      if ((cur.archivedAt !== null) === archive) return { row: cur, changed: false };
      const row = await tx.taskType.update({
        where: { id },
        data: { archivedAt: archive ? new Date() : null },
      });
      return { row, changed: true };
    });
    if (changed) {
      await this.audit.log(archive ? 'task_type.archived' : 'task_type.restored', {
        type: 'task_type',
        id: row.id,
      });
    }
    return toType(row);
  }

  private async uniqueName(tx: TxClient, businessId: string, name: string, exceptId?: string) {
    const clash = await tx.taskType.findFirst({
      where: {
        businessId,
        name: { equals: name, mode: 'insensitive' },
        ...(exceptId ? { id: { not: exceptId } } : {}),
      },
      select: { id: true },
    });
    if (clash) throw taskErrors.duplicateName('task type');
  }

  private async write<T>(businessId: string, fn: (tx: TxClient) => Promise<T>): Promise<T> {
    try {
      return await this.inFirm(businessId, fn);
    } catch (e) {
      if (isUniqueViolation(e)) throw taskErrors.duplicateName('task type');
      throw e;
    }
  }
}
