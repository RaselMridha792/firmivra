import { Inject, Injectable } from '@nestjs/common';
import type { Database, Prisma, TxClient } from '@firmivra/db';
import type {
  AppointmentType,
  AppointmentTypesQuery,
  CreateAppointmentTypeRequest,
  UpdateAppointmentTypeRequest,
} from '@firmivra/types';
import type { z } from 'zod';
import { AuditService } from '../audit/audit.service.js';
import { DATABASE } from '../database/database.module.js';
import { DEFAULT_CUTOFF_HOURS } from './calendar.js';
import { retryWhenBusy, tryLock, typeNamesLockKey } from './calendar-locks.js';
import { errors, isUniqueViolation } from './errors.js';

type ListQuery = z.output<typeof AppointmentTypesQuery>;
type CreateBody = z.output<typeof CreateAppointmentTypeRequest>;
type UpdateBody = z.output<typeof UpdateAppointmentTypeRequest>;

const typeSelect = {
  id: true,
  name: true,
  durationMinutes: true,
  locationKind: true,
  clientBookable: true,
  sortOrder: true,
  archivedAt: true,
} satisfies Prisma.AppointmentTypeSelect;

type TypeRow = Prisma.AppointmentTypeGetPayload<{ select: typeof typeSelect }>;

export function toAppointmentType(row: TypeRow): AppointmentType {
  return {
    ...row,
    // appointment_types.cancel_cutoff_hours is requested from R0; until then, the default.
    cancelCutoffHours: DEFAULT_CUTOFF_HOURS,
    archivedAt: row.archivedAt?.toISOString() ?? null,
  };
}

/**
 * The kinds of appointment the firm offers (contract in packages/types/src/appointments). Every
 * member reads; Owner and Admin change (the routes say so). Names are unique per firm, ignoring
 * case. Changes are audited with field names only.
 */
@Injectable()
export class AppointmentTypesService {
  constructor(
    @Inject(DATABASE) private readonly database: Database,
    private readonly audit: AuditService,
  ) {}

  /** One transaction in the firm's scope, tried again while the names lock is busy. */
  private inFirm<T>(businessId: string, fn: (tx: TxClient) => Promise<T>): Promise<T> {
    return retryWhenBusy(() => this.database.withScope({ kind: 'business', businessId }, fn));
  }

  async list(businessId: string, q: ListQuery): Promise<AppointmentType[]> {
    const rows = await this.database.forBusiness(businessId).appointmentType.findMany({
      where: {
        businessId,
        ...(q.status === 'active' ? { archivedAt: null } : {}),
        ...(q.status === 'archived' ? { archivedAt: { not: null } } : {}),
      },
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }, { id: 'asc' }],
      select: typeSelect,
    });
    return rows.map(toAppointmentType);
  }

  async create(businessId: string, body: CreateBody): Promise<AppointmentType> {
    if (body.cancelCutoffHours !== DEFAULT_CUTOFF_HOURS) throw errors.cutoffNotSupported();
    const row = await this.write(businessId, async (tx) => {
      await this.uniqueName(tx, businessId, body.name);
      const last = await tx.appointmentType.aggregate({
        where: { businessId },
        _max: { sortOrder: true },
      });
      const next = last._max.sortOrder === null ? 0 : Math.min(last._max.sortOrder + 1, 1000);
      return tx.appointmentType.create({
        data: {
          businessId,
          name: body.name,
          durationMinutes: body.durationMinutes,
          locationKind: body.locationKind,
          clientBookable: body.clientBookable,
          sortOrder: body.sortOrder ?? next,
        },
        select: typeSelect,
      });
    });
    await this.audit.log(
      'appointment_type.created',
      { type: 'appointment_type', id: row.id },
      { fields: Object.keys(body).sort() },
    );
    return toAppointmentType(row);
  }

  async update(businessId: string, id: string, body: UpdateBody): Promise<AppointmentType> {
    if (body.cancelCutoffHours !== undefined && body.cancelCutoffHours !== DEFAULT_CUTOFF_HOURS) {
      throw errors.cutoffNotSupported();
    }
    const { cancelCutoffHours: _cutoff, ...changes } = body;
    const data = Object.fromEntries(Object.entries(changes).filter(([, v]) => v !== undefined));
    const row = await this.write(businessId, async (tx) => {
      const current = await this.find(tx, businessId, id, true);
      if (body.name !== undefined && body.name.toLowerCase() !== current.name.toLowerCase()) {
        await this.uniqueName(tx, businessId, body.name, id);
      }
      if (Object.keys(data).length === 0) return current;
      return tx.appointmentType.update({ where: { id }, data, select: typeSelect });
    });
    await this.audit.log(
      'appointment_type.updated',
      { type: 'appointment_type', id },
      { fields: Object.keys(body).sort() },
    );
    return toAppointmentType(row);
  }

  /**
   * Archived types stay on past appointments; nobody books them. Repeating is harmless: the row
   * is locked first, so parallel calls agree on one change and one audit row.
   */
  async setArchived(businessId: string, id: string, archive: boolean): Promise<AppointmentType> {
    const { row, changed } = await this.inFirm(businessId, async (tx) => {
      const current = await this.find(tx, businessId, id, true);
      if ((current.archivedAt !== null) === archive) return { row: current, changed: false };
      const updated = await tx.appointmentType.update({
        where: { id },
        data: { archivedAt: archive ? new Date() : null },
        select: typeSelect,
      });
      return { row: updated, changed: true };
    });
    if (changed) {
      await this.audit.log(archive ? 'appointment_type.archived' : 'appointment_type.restored', {
        type: 'appointment_type',
        id,
      });
    }
    return toAppointmentType(row);
  }

  /**
   * The type in this firm, else 404. With `lock`, its row stays locked until the transaction ends
   * (taken before any advisory lock, so nothing waits on a row while holding one).
   */
  private async find(tx: TxClient, businessId: string, id: string, lock = false): Promise<TypeRow> {
    if (lock) {
      await tx.$executeRaw`
        SELECT 1 FROM appointment_types
        WHERE business_id = ${businessId}::uuid AND id = ${id}::uuid
        FOR UPDATE`;
    }
    const row = await tx.appointmentType.findFirst({
      where: { businessId, id },
      select: typeSelect,
    });
    if (!row) throw errors.notFound();
    return row;
  }

  /**
   * One name per firm, ignoring case, archived types included (the database's unique index is
   * exact; it stays the last line). Name changes at one firm run one at a time: the names lock
   * is tried, and a busy one starts the transaction again (retryWhenBusy).
   */
  private async uniqueName(
    tx: TxClient,
    businessId: string,
    name: string,
    exceptId?: string,
  ): Promise<void> {
    await tryLock(tx, typeNamesLockKey(businessId));
    // A firm has a handful of types; comparing here keeps % and _ plain characters.
    const types = await tx.appointmentType.findMany({
      where: { businessId },
      select: { id: true, name: true },
    });
    const wanted = name.toLowerCase();
    if (types.some((t) => t.id !== exceptId && t.name.toLowerCase() === wanted)) {
      throw errors.duplicateName();
    }
  }

  private async write<T>(businessId: string, fn: (tx: TxClient) => Promise<T>): Promise<T> {
    try {
      return await this.inFirm(businessId, fn);
    } catch (e) {
      if (isUniqueViolation(e)) throw errors.duplicateName();
      throw e;
    }
  }
}
