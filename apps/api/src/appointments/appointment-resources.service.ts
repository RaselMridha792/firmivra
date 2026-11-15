import { Inject, Injectable } from '@nestjs/common';
import type { Database, TxClient } from '@firmivra/db';
import type {
  AppointmentResources,
  CreateEquipmentRequest,
  CreateRoomRequest,
  FirmEquipment,
  FirmRoom,
  UpdateEquipmentRequest,
  UpdateRoomRequest,
} from '@firmivra/types';
import { z } from 'zod';
import { AuditService } from '../audit/audit.service.js';
import { DATABASE } from '../database/database.module.js';
import { retryWhenBusy, tryLock } from './calendar-locks.js';
import { errors, isUniqueViolation } from './errors.js';

type RoomBody = z.output<typeof CreateRoomRequest>;
type RenameBody = z.output<typeof UpdateRoomRequest>;
type EquipmentBody = z.output<typeof CreateEquipmentRequest>;
type EquipmentChange = z.output<typeof UpdateEquipmentRequest>;

const roomSelect = {
  id: true,
  name: true,
  archivedAt: true,
  updatedAt: true,
  office: { select: { id: true, name: true } },
} as const;

const equipmentSelect = {
  id: true,
  name: true,
  description: true,
  archivedAt: true,
  updatedAt: true,
  office: { select: { id: true, name: true } },
} as const;

type RoomRow = {
  id: string;
  name: string;
  archivedAt: Date | null;
  updatedAt: Date;
  office: { id: string; name: string };
};
type EquipmentRow = Omit<RoomRow, 'office'> & {
  description: string | null;
  office: { id: string; name: string } | null;
};

/** One name check of a firm's rooms and equipment at a time (names compare ignoring case). */
const namesLockKey = (businessId: string) =>
  `appointment_resource_names:${businessId.toLowerCase()}`;

const toRoom = (r: RoomRow, upcoming: number): FirmRoom => ({
  id: r.id,
  name: r.name,
  office: r.office,
  archivedAt: r.archivedAt?.toISOString() ?? null,
  upcoming,
  updatedAt: r.updatedAt.toISOString(),
});

const toEquipment = (e: EquipmentRow, upcoming: number): FirmEquipment => ({
  id: e.id,
  name: e.name,
  description: e.description,
  office: e.office,
  archivedAt: e.archivedAt?.toISOString() ?? null,
  upcoming,
  updatedAt: e.updatedAt.toISOString(),
});

const roomTaken = () => errors.duplicate('This office already has a room with this name');
const itemTaken = () => errors.duplicate('An item of equipment with this name already exists');

/**
 * Appointments Review 2 (A2), Settings > Appointment Settings: the firm's rooms and equipment
 * (contract in packages/types/src/appointments/resources.ts). Owner and Admin only (the
 * controller). A room's name is unique within its office, archived rooms included (the database's
 * unique index is exact; this check ignores case); an item's name is unique among the firm's live
 * items ignoring case (the database's own rule). Archiving keeps every appointment that holds it;
 * only new bookings stop. Audit rows hold ids and field names only.
 */
@Injectable()
export class AppointmentResourcesService {
  constructor(
    @Inject(DATABASE) private readonly database: Database,
    private readonly audit: AuditService,
  ) {}

  private inFirm<T>(businessId: string, fn: (tx: TxClient) => Promise<T>): Promise<T> {
    return this.database.withScope({ kind: 'business', businessId }, fn);
  }

  /** A name change at one firm at a time; a busy lock starts the transaction again. */
  private async named<T>(
    businessId: string,
    taken: () => Error,
    fn: (tx: TxClient) => Promise<T>,
  ): Promise<T> {
    try {
      return await retryWhenBusy(() =>
        this.inFirm(businessId, async (tx) => {
          await tryLock(tx, namesLockKey(businessId));
          return fn(tx);
        }),
      );
    } catch (e) {
      if (isUniqueViolation(e)) throw taken();
      throw e;
    }
  }

  async list(businessId: string): Promise<AppointmentResources> {
    return this.inFirm(businessId, async (tx) => {
      const rooms = await tx.firmRoom.findMany({
        where: { businessId },
        orderBy: [{ name: 'asc' }, { id: 'asc' }],
        select: roomSelect,
      });
      const equipment = await tx.firmEquipment.findMany({
        where: { businessId },
        orderBy: [{ name: 'asc' }, { id: 'asc' }],
        select: equipmentSelect,
      });
      const offices = await tx.firmOffice.findMany({
        where: { businessId, archivedAt: null },
        orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }, { id: 'asc' }],
        select: { id: true, name: true },
      });
      const roomCounts = await this.roomsUpcoming(tx, businessId);
      const itemCounts = await this.equipmentUpcoming(tx, businessId);
      return {
        rooms: rooms.map((r) => toRoom(r, roomCounts.get(r.id) ?? 0)),
        equipment: equipment.map((e) => toEquipment(e, itemCounts.get(e.id) ?? 0)),
        offices,
      };
    });
  }

  // ---------- Rooms ----------

  async addRoom(businessId: string, body: RoomBody): Promise<FirmRoom> {
    const row = await this.named(businessId, roomTaken, async (tx) => {
      const office = await tx.firmOffice.findFirst({
        where: { businessId, id: body.officeId, archivedAt: null },
        select: { id: true },
      });
      if (!office) throw errors.notFound();
      await this.uniqueRoom(tx, businessId, office.id, body.name);
      return tx.firmRoom.create({
        data: { businessId, officeId: office.id, name: body.name },
        select: roomSelect,
      });
    });
    await this.audit.log(
      'appointment_room.created',
      { type: 'firm_room', id: row.id },
      { officeId: row.office.id },
    );
    return toRoom(row, 0);
  }

  async renameRoom(businessId: string, id: string, body: RenameBody): Promise<FirmRoom> {
    const { row, changed, upcoming } = await this.named(businessId, roomTaken, async (tx) => {
      const current = await this.room(tx, businessId, id);
      const count = (await this.roomsUpcoming(tx, businessId, id)).get(id) ?? 0;
      if (current.name === body.name) return { row: current, changed: false, upcoming: count };
      if (current.name.toLowerCase() !== body.name.toLowerCase()) {
        await this.uniqueRoom(tx, businessId, current.office.id, body.name, id);
      }
      const updated = await tx.firmRoom.update({
        where: { id },
        data: { name: body.name },
        select: roomSelect,
      });
      return { row: updated, changed: true, upcoming: count };
    });
    if (changed) {
      await this.audit.log(
        'appointment_room.updated',
        { type: 'firm_room', id },
        { fields: ['name'] },
      );
    }
    return toRoom(row, upcoming);
  }

  /** Archive or Restore; repeating it changes nothing and writes no audit row. */
  async setRoomArchived(businessId: string, id: string, archive: boolean): Promise<FirmRoom> {
    const { row, changed, upcoming } = await this.inFirm(businessId, async (tx) => {
      const current = await this.room(tx, businessId, id);
      const count = (await this.roomsUpcoming(tx, businessId, id)).get(id) ?? 0;
      if ((current.archivedAt !== null) === archive) {
        return { row: current, changed: false, upcoming: count };
      }
      const updated = await tx.firmRoom.update({
        where: { id },
        data: { archivedAt: archive ? new Date() : null },
        select: roomSelect,
      });
      return { row: updated, changed: true, upcoming: count };
    });
    if (changed) {
      await this.audit.log(
        archive ? 'appointment_room.archived' : 'appointment_room.restored',
        { type: 'firm_room', id },
        // How many upcoming appointments keep the archived room.
        archive ? { upcoming } : undefined,
      );
    }
    return toRoom(row, upcoming);
  }

  // ---------- Equipment ----------

  async addEquipment(businessId: string, body: EquipmentBody): Promise<FirmEquipment> {
    const row = await this.named(businessId, itemTaken, async (tx) => {
      const officeId = body.officeId ? await this.office(tx, businessId, body.officeId) : null;
      await this.uniqueItem(tx, businessId, body.name);
      return tx.firmEquipment.create({
        data: { businessId, officeId, name: body.name, description: body.description ?? null },
        select: equipmentSelect,
      });
    });
    await this.audit.log(
      'appointment_equipment.created',
      { type: 'firm_equipment', id: row.id },
      { officeId: row.office?.id ?? null },
    );
    return toEquipment(row, 0);
  }

  async updateEquipment(
    businessId: string,
    id: string,
    body: EquipmentChange,
  ): Promise<FirmEquipment> {
    const { row, fields, upcoming } = await this.named(businessId, itemTaken, async (tx) => {
      const current = await this.item(tx, businessId, id);
      const count = (await this.equipmentUpcoming(tx, businessId, id)).get(id) ?? 0;
      const data: { name?: string; description?: string | null; officeId?: string | null } = {};
      if (body.name !== undefined && body.name !== current.name) {
        // Only a live item's name must be free (the database's rule).
        if (!current.archivedAt && body.name.toLowerCase() !== current.name.toLowerCase()) {
          await this.uniqueItem(tx, businessId, body.name, id);
        }
        data.name = body.name;
      }
      if (body.description !== undefined && body.description !== current.description) {
        data.description = body.description;
      }
      if (body.officeId !== undefined && body.officeId !== (current.office?.id ?? null)) {
        data.officeId = body.officeId ? await this.office(tx, businessId, body.officeId) : null;
      }
      const changed = Object.keys(data).sort();
      if (changed.length === 0) return { row: current, fields: changed, upcoming: count };
      const updated = await tx.firmEquipment.update({
        where: { id },
        data,
        select: equipmentSelect,
      });
      return { row: updated, fields: changed, upcoming: count };
    });
    if (fields.length > 0) {
      await this.audit.log(
        'appointment_equipment.updated',
        { type: 'firm_equipment', id },
        { fields: fields.map((f) => (f === 'officeId' ? 'office' : f)) },
      );
    }
    return toEquipment(row, upcoming);
  }

  /**
   * Archive or Restore. A restored item's name must be free among the live ones (409
   * DUPLICATE_NAME); repeating either changes nothing and writes no audit row.
   */
  async setEquipmentArchived(
    businessId: string,
    id: string,
    archive: boolean,
  ): Promise<FirmEquipment> {
    const { row, changed, upcoming } = await this.named(businessId, itemTaken, async (tx) => {
      const current = await this.item(tx, businessId, id);
      const count = (await this.equipmentUpcoming(tx, businessId, id)).get(id) ?? 0;
      if ((current.archivedAt !== null) === archive) {
        return { row: current, changed: false, upcoming: count };
      }
      if (!archive) await this.uniqueItem(tx, businessId, current.name, id);
      const updated = await tx.firmEquipment.update({
        where: { id },
        data: { archivedAt: archive ? new Date() : null },
        select: equipmentSelect,
      });
      return { row: updated, changed: true, upcoming: count };
    });
    if (changed) {
      await this.audit.log(
        archive ? 'appointment_equipment.archived' : 'appointment_equipment.restored',
        { type: 'firm_equipment', id },
        archive ? { upcoming } : undefined,
      );
    }
    return toEquipment(row, upcoming);
  }

  // ---------- Pieces ----------

  /** The room in this firm, row locked, else 404. */
  private async room(tx: TxClient, businessId: string, id: string): Promise<RoomRow> {
    await tx.$executeRaw`
      SELECT 1 FROM firm_rooms
      WHERE business_id = ${businessId}::uuid AND id = ${id}::uuid
      FOR NO KEY UPDATE`;
    const row = await tx.firmRoom.findFirst({ where: { businessId, id }, select: roomSelect });
    if (!row) throw errors.notFound();
    return row;
  }

  /** The item in this firm, row locked, else 404. */
  private async item(tx: TxClient, businessId: string, id: string): Promise<EquipmentRow> {
    await tx.$executeRaw`
      SELECT 1 FROM firm_equipment
      WHERE business_id = ${businessId}::uuid AND id = ${id}::uuid
      FOR NO KEY UPDATE`;
    const row = await tx.firmEquipment.findFirst({
      where: { businessId, id },
      select: equipmentSelect,
    });
    if (!row) throw errors.notFound();
    return row;
  }

  /** An office of this firm that is not archived (an inactive one may still hold things), else 404. */
  private async office(tx: TxClient, businessId: string, id: string): Promise<string> {
    const office = await tx.firmOffice.findFirst({
      where: { businessId, id, archivedAt: null },
      select: { id: true },
    });
    if (!office) throw errors.notFound();
    return office.id;
  }

  /** A room's name within its office, archived rooms included, ignoring case. */
  private async uniqueRoom(
    tx: TxClient,
    businessId: string,
    officeId: string,
    name: string,
    exceptId?: string,
  ): Promise<void> {
    // An office has a handful of rooms; comparing here keeps % and _ plain characters.
    const rooms = await tx.firmRoom.findMany({
      where: { businessId, officeId },
      select: { id: true, name: true },
    });
    const wanted = name.toLowerCase();
    if (rooms.some((r) => r.id !== exceptId && r.name.toLowerCase() === wanted)) throw roomTaken();
  }

  /** An item's name among the firm's live items, ignoring case. */
  private async uniqueItem(
    tx: TxClient,
    businessId: string,
    name: string,
    exceptId?: string,
  ): Promise<void> {
    const same = await tx.firmEquipment.findFirst({
      where: {
        businessId,
        archivedAt: null,
        name: { equals: name, mode: 'insensitive' },
        ...(exceptId ? { id: { not: exceptId } } : {}),
      },
      select: { id: true },
    });
    if (same) throw itemTaken();
  }

  /** Upcoming live appointments per room (one room with `id`). */
  private async roomsUpcoming(
    tx: TxClient,
    businessId: string,
    id?: string,
  ): Promise<Map<string, number>> {
    const rows = await tx.appointment.groupBy({
      by: ['roomId'],
      where: {
        businessId,
        roomId: id ?? { not: null },
        status: 'SCHEDULED',
        endsAt: { gt: new Date() },
      },
      _count: { _all: true },
    });
    return new Map(rows.flatMap((r) => (r.roomId ? [[r.roomId, r._count._all] as const] : [])));
  }

  /** Upcoming live appointments per item (one item with `id`). */
  private async equipmentUpcoming(
    tx: TxClient,
    businessId: string,
    id?: string,
  ): Promise<Map<string, number>> {
    const rows = await tx.appointmentEquipment.groupBy({
      by: ['equipmentId'],
      where: {
        businessId,
        ...(id ? { equipmentId: id } : {}),
        live: true,
        endsAt: { gt: new Date() },
        appointment: { status: 'SCHEDULED' },
      },
      _count: { _all: true },
    });
    return new Map(rows.map((r) => [r.equipmentId, r._count._all] as const));
  }
}
