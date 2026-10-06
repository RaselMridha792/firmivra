import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import { Prisma, type Database, type TxClient } from '@firmivra/db';
import {
  FirmAppointment,
  FirmAppointmentType,
  FirmBlockedTime,
  FirmWorkingHours,
  FirmAppointmentHistory,
  ListFirmAppointmentsResponse,
  ListFirmAvailableSlotsResponse,
  ListFirmAppointmentHistoryResponse,
  ListProviderBlockedTimeResponse,
  type ListFirmAppointmentsQuery,
  type ListFirmAvailableSlotsQuery,
  type ListProviderBlockedTimeQuery,
  type ListFirmAppointmentProvidersQuery,
  type BookFirmAppointmentRequest,
  type BookPortalAppointmentRequest,
  type UpdateFirmAppointmentDetailsRequest,
  type FirmAppointmentTypeInput,
  type FirmAppointmentTypePatch,
} from '@firmivra/types';
import { DATABASE } from '../database/database.module.js';
import { AuditService } from '../audit/audit.service.js';
import {
  firmContext,
  decodeCursor,
  encodeCursor,
  missing,
  pageBoundary,
} from '../firm-common/context.js';
import { currentActor, denied, type FirmActor } from '../firm-common/actor.js';
import { requireTables } from '../firm-common/schema.js';
import { SqlRecords } from '../firm-common/sql-records.js';
import { hasPostgresCode } from '../firm-common/postgres-errors.js';
import { availableSlots, validateRange, validateHours, insideHours, MINUTE } from './calendar.js';
import { AppointmentJobs } from './appointment-jobs.service.js';
export type AppointmentRow = FirmAppointment & {
  businessId: string;
  occupiedStartsAt: string;
  occupiedEndsAt: string;
  bufferBeforeMinutes: number;
  bufferAfterMinutes: number;
  createdByUserId: string;
};
type HoursRow = FirmWorkingHours & { id: string; providerMembershipId: string };
type Actor = Awaited<ReturnType<typeof currentActor>>;
export const appointmentTables = [
  'appointment_types',
  'working_hours',
  'blocked_times',
  'appointments',
  'appointment_histories',
  'appointment_reminders',
];
const conflict = (code: string, message: string) => new ConflictException({ code, message });
const project = <T extends { shape: Record<string, unknown>; parse: (value: unknown) => unknown }>(
  schema: T,
  row: Record<string, unknown>,
) => schema.parse(Object.fromEntries(Object.keys(schema.shape).map((key) => [key, row[key]])));
const appointmentDto = (row: AppointmentRow) => project(FirmAppointment, row) as FirmAppointment;
const typeDto = (row: FirmAppointmentType) =>
  project(FirmAppointmentType, row) as FirmAppointmentType;
const blockDto = (row: FirmBlockedTime) => project(FirmBlockedTime, row) as FirmBlockedTime;
@Injectable()
export class AppointmentsService {
  private async protectSlot<T>(work: () => Promise<T>) {
    try {
      return await work();
    } catch (error) {
      if (hasPostgresCode(error, '23P01'))
        throw conflict('SLOT_UNAVAILABLE', 'Slot is unavailable');
      throw error;
    }
  }
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly audit: AuditService,
    private readonly jobs: AppointmentJobs,
  ) {}
  private async scoped<T>(
    write: boolean,
    fn: (
      tx: TxClient,
      records: SqlRecords,
      ctx: FirmActor,
      actor: Actor,
      timezone: string,
    ) => Promise<T>,
  ) {
    const ctx = firmContext();
    return this.db.withScope({ kind: 'business', businessId: ctx.businessId }, async (tx) => {
      if (write) {
        const firms = await tx.$queryRaw<
          { id: string }[]
        >`SELECT id FROM businesses WHERE id=${ctx.businessId}::uuid AND status='ACTIVE' FOR UPDATE`;
        if (!firms.length) throw missing();
      }
      const actor = await currentActor(tx, ctx),
        settings = await tx.businessSettings.findUnique({
          where: { businessId: ctx.businessId },
          select: { timezone: true, enabledModules: true },
        });
      if (!settings?.enabledModules.includes('appointments')) throw denied();
      await requireTables(tx, appointmentTables);
      return fn(tx, new SqlRecords(tx, ctx.businessId), ctx, actor, settings.timezone);
    });
  }
  private manage(actor: Actor) {
    if (actor.role !== 'OWNER' && actor.role !== 'ADMIN') throw denied();
  }
  private async provider(tx: TxClient, ctx: FirmActor, actor: Actor, id: string, manage = false) {
    const member = await tx.membership.findFirst({
      where: { businessId: ctx.businessId, id, status: 'ACTIVE' },
      select: { id: true, userId: true, user: { select: { name: true } } },
    });
    if (!member) throw missing();
    if (actor.role === 'STAFF' && ('membershipId' in actor ? actor.membershipId !== id : true))
      throw denied();
    if (manage && actor.role === 'CLIENT') throw denied();
    return {
      id: member.id,
      userId: member.userId,
      name: (member.user.name?.trim() || 'Firm member').slice(0, 200),
    };
  }
  private async lockProvider(tx: TxClient, businessId: string, id: string) {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${businessId + ':appointment:' + id},0))`;
  }
  private async type(records: SqlRecords, id: string, actor: Actor) {
    const row = await records.one<FirmAppointmentType>('appointment_types', id);
    if (!row.active || (actor.role === 'CLIENT' && !row.clientBookingEnabled)) throw missing();
    return row;
  }
  async types() {
    const items = await this.scoped(false, async (_, records, __, actor) => {
      const rows = await records.many<FirmAppointmentType>(
        'appointment_types',
        actor.role === 'CLIENT'
          ? Prisma.sql`AND active=true AND client_booking_enabled=true`
          : Prisma.empty,
        Prisma.sql`created_at ASC,id ASC`,
        101,
      );
      if (rows.length > 100) throw conflict('CONFIGURATION_LIMIT', 'Too many appointment types');
      return rows.map(typeDto);
    });
    await this.audit.log('appointment.types_listed', { type: 'appointmentType' });
    return { items };
  }
  private validateType(row: FirmAppointmentTypeInput) {
    if (
      row.isIntroCall &&
      (row.durationMinutes !== 5 ||
        row.allowedMethods.length !== 1 ||
        row.allowedMethods[0] !== 'PHONE')
    )
      throw new BadRequestException({
        code: 'INVALID_INTRO_CALL',
        message: 'Introductory calls must be 5 minutes and phone only',
      });
  }
  async createType(body: FirmAppointmentTypeInput) {
    const row = await this.scoped(true, async (_, records, __, actor) => {
      this.manage(actor);
      this.validateType(body);
      const rows = await records.many<FirmAppointmentType>(
        'appointment_types',
        Prisma.empty,
        Prisma.sql`id`,
        101,
      );
      if (rows.length >= 100)
        throw conflict('CONFIGURATION_LIMIT', 'At most 100 appointment types');
      if (rows.some((row) => row.name.toLowerCase() === body.name.trim().toLowerCase()))
        throw conflict('DUPLICATE_NAME', 'Type name already exists');
      return records.insert<FirmAppointmentType>('appointment_types', {
        ...body,
        name: body.name.trim(),
      });
    });
    await this.audit.log('appointment.type_created', { type: 'appointmentType', id: row.id });
    return typeDto(row);
  }
  async updateType(id: string, body: FirmAppointmentTypePatch) {
    const row = await this.scoped(true, async (_, records, __, actor) => {
      this.manage(actor);
      const current = await records.one<FirmAppointmentType>('appointment_types', id),
        merged = { ...current, ...body };
      this.validateType(merged);
      if (body.name) {
        const duplicate = await records.many<FirmAppointmentType>(
          'appointment_types',
          Prisma.sql`AND id<>${id}::uuid AND lower(name)=lower(${body.name.trim()})`,
        );
        if (duplicate.length) throw conflict('DUPLICATE_NAME', 'Type name already exists');
      }
      return records.patch<FirmAppointmentType>('appointment_types', id, {
        ...body,
        ...(body.name ? { name: body.name.trim() } : {}),
        updatedAt: new Date().toISOString(),
      });
    });
    await this.audit.log('appointment.type_updated', { type: 'appointmentType', id });
    return typeDto(row);
  }
  private hours(records: SqlRecords, providerId: string) {
    return records.many<HoursRow>(
      'working_hours',
      Prisma.sql`AND provider_membership_id=${providerId}::uuid`,
      Prisma.sql`weekday,start_minute,id`,
      50,
    );
  }
  async workingHours(providerId: string) {
    const rows = await this.scoped(false, async (tx, records, ctx, actor) => {
      await this.provider(tx, ctx, actor, providerId, true);
      return this.hours(records, providerId);
    });
    await this.audit.log('appointment.hours_viewed', { type: 'membership', id: providerId });
    return {
      items: rows.map((row) => ({
        weekday: row.weekday,
        startMinute: row.startMinute,
        endMinute: row.endMinute,
      })),
    };
  }
  async saveHours(providerId: string, hours: FirmWorkingHours[]) {
    validateHours(hours);
    await this.scoped(true, async (tx, records, ctx, actor, timezone) => {
      await this.provider(tx, ctx, actor, providerId, true);
      await this.lockProvider(tx, ctx.businessId, providerId);
      const bookings = await records.many<AppointmentRow>(
        'appointments',
        Prisma.sql`AND provider_membership_id=${providerId}::uuid AND status='BOOKED' AND occupied_ends_at>now()`,
        Prisma.sql`id`,
        10001,
      );
      if (bookings.length > 10000)
        throw conflict('CONFIGURATION_LIMIT', 'Calendar must be reviewed in smaller batches');
      if (
        bookings.some(
          (row) =>
            !insideHours(
              new Date(row.occupiedStartsAt).getTime(),
              new Date(row.occupiedEndsAt).getTime(),
              hours,
              timezone,
            ),
        )
      )
        throw conflict('EXISTING_BOOKINGS', 'Working hours would invalidate existing bookings');
      await tx.$executeRaw`DELETE FROM working_hours WHERE business_id=${ctx.businessId}::uuid AND provider_membership_id=${providerId}::uuid`;
      for (const row of hours)
        await records.insert('working_hours', { providerMembershipId: providerId, ...row });
    });
    await this.audit.log('appointment.hours_updated', { type: 'membership', id: providerId });
    return { items: hours };
  }
  async blocked(query: ListProviderBlockedTimeQuery) {
    validateRange(query.from, query.to);
    const ctx = firmContext(),
      filters = {
        module: 'blocked-time',
        provider: query.providerMembershipId,
        from: query.from,
        to: query.to,
      },
      cursor = decodeCursor(query.cursor, ctx, filters);
    const rows = await this.scoped(false, async (tx, records, scope, actor) => {
      await this.provider(tx, scope, actor, query.providerMembershipId, true);
      return records.many<FirmBlockedTime>(
        'blocked_times',
        Prisma.sql`AND provider_membership_id=${query.providerMembershipId}::uuid AND starts_at<${new Date(query.to)} AND ends_at>${new Date(query.from)} ${cursor ? Prisma.sql`AND (created_at,id)<(${cursor.createdAt},${cursor.id}::uuid)` : Prisma.empty}`,
        Prisma.sql`created_at DESC,id DESC`,
        query.limit + 1,
      );
    });
    const items = rows.slice(0, query.limit);
    await this.audit.log('appointment.blocks_listed', {
      type: 'membership',
      id: query.providerMembershipId,
    });
    return ListProviderBlockedTimeResponse.parse({
      items: items.map(blockDto),
      nextCursor: rows.length > query.limit ? encodeCursor(ctx, filters, items.at(-1)!) : null,
    });
  }
  async createBlock(body: Omit<FirmBlockedTime, 'id' | 'createdAt'>) {
    const [a, b] = validateRange(body.startsAt, body.endsAt);
    const row = await this.scoped(true, async (tx, records, ctx, actor) => {
      await this.provider(tx, ctx, actor, body.providerMembershipId, true);
      await this.lockProvider(tx, ctx.businessId, body.providerMembershipId);
      const bookings = await records.many<AppointmentRow>(
        'appointments',
        Prisma.sql`AND provider_membership_id=${body.providerMembershipId}::uuid AND status='BOOKED' AND occupied_starts_at<${new Date(b)} AND occupied_ends_at>${new Date(a)}`,
        Prisma.sql`id`,
        1,
      );
      if (bookings.length) throw conflict('EXISTING_BOOKINGS', 'Blocked time overlaps a booking');
      return records.insert<FirmBlockedTime>('blocked_times', {
        providerMembershipId: body.providerMembershipId,
        startsAt: body.startsAt,
        endsAt: body.endsAt,
        reason: body.reason,
      });
    });
    await this.audit.log('appointment.block_created', { type: 'blockedTime', id: row.id });
    return blockDto(row);
  }
  async removeBlock(id: string) {
    await this.scoped(true, async (tx, records, ctx, actor) => {
      const row = await records.one<FirmBlockedTime>('blocked_times', id);
      await this.provider(tx, ctx, actor, row.providerMembershipId, true);
      await this.lockProvider(tx, ctx.businessId, row.providerMembershipId);
      await tx.$executeRaw`DELETE FROM blocked_times WHERE business_id=${ctx.businessId}::uuid AND id=${id}::uuid`;
    });
    await this.audit.log('appointment.block_removed', { type: 'blockedTime', id });
    return { ok: true as const };
  }
  async providers(query: ListFirmAppointmentProvidersQuery) {
    const ctx = firmContext(),
      filters = { module: 'appointment-providers', typeId: query.typeId },
      cursor = decodeCursor(query.cursor, ctx, filters);
    const rows = await this.scoped(false, async (tx, records, ctx, actor) => {
      await this.type(records, query.typeId, actor);
      return tx.membership.findMany({
        where: {
          businessId: ctx.businessId,
          status: 'ACTIVE',
          ...(actor.role === 'STAFF' ? { userId: ctx.userId } : {}),
          ...pageBoundary(cursor),
        },
        select: { id: true, createdAt: true, user: { select: { name: true } } },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: query.limit + 1,
      });
    });
    const page = rows.slice(0, query.limit),
      items = page.map((row) => ({
        id: row.id,
        name: (row.user.name?.trim() || 'Firm member').slice(0, 200),
      }));
    await this.audit.log('appointment.providers_listed', { type: 'membership' });
    return {
      items,
      nextCursor: rows.length > query.limit ? encodeCursor(ctx, filters, page.at(-1)!) : null,
    };
  }
  private async calendar(records: SqlRecords, providerId: string, from: string, to: string) {
    const [a, b] = validateRange(from, to),
      extension = 240 * MINUTE;
    const blocked = await records.many<FirmBlockedTime>(
      'blocked_times',
      Prisma.sql`AND provider_membership_id=${providerId}::uuid AND starts_at<${new Date(b + extension)} AND ends_at>${new Date(a - extension)}`,
      Prisma.sql`id`,
      10001,
    );
    const bookings = await records.many<AppointmentRow>(
      'appointments',
      Prisma.sql`AND provider_membership_id=${providerId}::uuid AND status='BOOKED' AND occupied_starts_at<${new Date(b + extension)} AND occupied_ends_at>${new Date(a - extension)}`,
      Prisma.sql`id`,
      10001,
    );
    if (blocked.length > 10000 || bookings.length > 10000)
      throw conflict('CONFIGURATION_LIMIT', 'Request a smaller availability range');
    return { hours: await this.hours(records, providerId), blocked, bookings };
  }
  async availability(query: ListFirmAvailableSlotsQuery) {
    const result = await this.scoped(false, async (tx, records, ctx, actor, timezone) => {
      await this.provider(tx, ctx, actor, query.providerMembershipId);
      const type = await this.type(records, query.typeId, actor),
        calendar = await this.calendar(records, query.providerMembershipId, query.from, query.to);
      return availableSlots({
        ...query,
        timezone,
        type,
        hours: calendar.hours,
        blocked: calendar.blocked,
        occupied: calendar.bookings.map((row) => ({
          startsAt: row.occupiedStartsAt,
          endsAt: row.occupiedEndsAt,
        })),
      });
    });
    await this.audit.log('appointment.availability_viewed', {
      type: 'membership',
      id: query.providerMembershipId,
    });
    return ListFirmAvailableSlotsResponse.parse(result);
  }
  private async visible(tx: TxClient, ctx: FirmActor, actor: Actor, row: AppointmentRow) {
    if (actor.role === 'CLIENT' && row.clientId !== actor.clientId) throw missing();
    if (
      actor.role === 'STAFF' &&
      row.providerMembershipId !== ('membershipId' in actor ? actor.membershipId : null)
    )
      throw missing();
    // Client archive/assignment visibility is checked again on mutations.
    const client = await tx.client.findFirst({
      where: { businessId: ctx.businessId, id: row.clientId, archivedAt: null },
      select: { id: true, assignedUserId: true, displayName: true },
    });
    if (!client) throw missing();
    return client;
  }
  async list(query: ListFirmAppointmentsQuery) {
    validateRange(query.from, query.to);
    const ctx = firmContext(),
      filters = {
        module: 'appointments',
        from: query.from,
        to: query.to,
        status: query.status ?? null,
        provider: query.providerMembershipId ?? null,
      },
      cursor = decodeCursor(query.cursor, ctx, filters);
    const rows = await this.scoped(false, async (tx, records, scope, actor) => {
      if (query.providerMembershipId)
        await this.provider(tx, scope, actor, query.providerMembershipId);
      return records.many<AppointmentRow>(
        'appointments',
        Prisma.sql`AND starts_at<${new Date(query.to)} AND ends_at>${new Date(query.from)} ${query.status ? Prisma.sql`AND status=${query.status}` : Prisma.empty} ${query.providerMembershipId ? Prisma.sql`AND provider_membership_id=${query.providerMembershipId}::uuid` : Prisma.empty} ${actor.role === 'CLIENT' ? Prisma.sql`AND client_id=${actor.clientId}::uuid` : actor.role === 'STAFF' ? Prisma.sql`AND provider_membership_id=${'membershipId' in actor ? actor.membershipId : null}::uuid` : Prisma.empty} AND EXISTS (SELECT 1 FROM clients c WHERE c.business_id=r.business_id AND c.id=r.client_id AND c.archived_at IS NULL) ${cursor ? Prisma.sql`AND (created_at,id)<(${cursor.createdAt},${cursor.id}::uuid)` : Prisma.empty}`,
        Prisma.sql`created_at DESC,id DESC`,
        query.limit + 1,
      );
    });
    const items = rows.slice(0, query.limit);
    await this.audit.log('appointment.listed', { type: 'appointment' });
    return ListFirmAppointmentsResponse.parse({
      items: items.map(appointmentDto),
      nextCursor: rows.length > query.limit ? encodeCursor(ctx, filters, items.at(-1)!) : null,
    });
  }
  async detail(id: string) {
    const row = await this.scoped(false, async (tx, records, ctx, actor) => {
      const found = await records.one<AppointmentRow>('appointments', id);
      await this.visible(tx, ctx, actor, found);
      return found;
    });
    await this.audit.log('appointment.viewed', { type: 'appointment', id });
    return appointmentDto(row);
  }
  private async freeSlot(
    records: SqlRecords,
    providerId: string,
    type: Pick<
      FirmAppointmentType,
      'durationMinutes' | 'bufferBeforeMinutes' | 'bufferAfterMinutes'
    >,
    startsAt: string,
    timezone: string,
    except?: string,
  ) {
    const start = new Date(startsAt).getTime();
    if (start % MINUTE !== 0)
      throw new BadRequestException({
        code: 'INVALID_START_TIME',
        message: 'Start must be a whole minute',
      });
    if (start <= Date.now()) throw conflict('SLOT_UNAVAILABLE', 'Slot is unavailable');
    const endsAt = new Date(start + type.durationMinutes * MINUTE).toISOString(),
      calendar = await this.calendar(records, providerId, startsAt, endsAt);
    const available = availableSlots({
      from: startsAt,
      to: endsAt,
      timezone,
      type,
      hours: calendar.hours,
      blocked: calendar.blocked,
      occupied: calendar.bookings
        .filter((row) => row.id !== except)
        .map((row) => ({ startsAt: row.occupiedStartsAt, endsAt: row.occupiedEndsAt })),
    });
    if (!available.slots.length) throw conflict('SLOT_UNAVAILABLE', 'Slot is unavailable');
    return {
      startsAt: new Date(start).toISOString(),
      endsAt,
      occupiedStartsAt: new Date(start - type.bufferBeforeMinutes * MINUTE).toISOString(),
      occupiedEndsAt: new Date(
        start + (type.durationMinutes + type.bufferAfterMinutes) * MINUTE,
      ).toISOString(),
    };
  }
  private async historyWrite(
    records: SqlRecords,
    ctx: FirmActor,
    row: AppointmentRow,
    action: FirmAppointmentHistory['action'],
    previous?: AppointmentRow,
    reason?: string,
  ) {
    await records.insert('appointment_histories', {
      appointmentId: row.id,
      action,
      actorUserId: ctx.userId,
      previousStartsAt: previous?.startsAt ?? null,
      previousEndsAt: previous?.endsAt ?? null,
      previousStatus: previous?.status ?? null,
      newStartsAt: row.startsAt,
      newEndsAt: row.endsAt,
      newStatus: row.status,
      reason: reason ?? null,
    });
  }
  private async ensureExclusion(tx: TxClient) {
    const rows = await tx.$queryRaw<
      { definition: string; valid: boolean }[]
    >`SELECT pg_get_constraintdef(c.oid) AS definition,i.indisvalid AS valid FROM pg_constraint c JOIN pg_index i ON i.indexrelid=c.conindid WHERE c.conrelid='appointments'::regclass AND c.contype='x' AND c.conname='appointments_no_overlap'`;
    const definition = rows[0]?.definition ?? '';
    if (
      !rows[0]?.valid ||
      !definition.includes('business_id WITH =') ||
      !definition.includes('provider_membership_id WITH =') ||
      !definition.includes("tstzrange(occupied_starts_at, occupied_ends_at, '[)'::text) WITH &&") ||
      !/WHERE\s+\(\(?status\s*=\s*'BOOKED'(?:::[\w".]+)?\)?\)/.test(definition)
    )
      throw new ServiceUnavailableException({
        code: 'SCHEMA_NOT_READY',
        message: 'Appointment overlap protection is unavailable',
      });
  }
  async book(body: BookFirmAppointmentRequest | BookPortalAppointmentRequest) {
    const row = await this.scoped(true, async (tx, records, ctx, actor, timezone) => {
      await this.ensureExclusion(tx);
      const provider = await this.provider(tx, ctx, actor, body.providerMembershipId);
      await this.lockProvider(tx, ctx.businessId, provider.id);
      const type = await this.type(records, body.typeId, actor);
      if (!type.allowedMethods.includes(body.method))
        throw new BadRequestException({
          code: 'INVALID_MEETING_METHOD',
          message: 'Method is not available for this type',
        });
      const clientId =
        actor.role === 'CLIENT' ? actor.clientId : 'clientId' in body ? body.clientId : null;
      const client = clientId
        ? await tx.client.findFirst({
            where: { businessId: ctx.businessId, id: clientId, archivedAt: null },
            select: { id: true, displayName: true, assignedUserId: true },
          })
        : null;
      if (!client) throw missing();
      if (actor.role === 'STAFF' && client.assignedUserId !== ctx.userId) throw missing();
      const slot = await this.freeSlot(records, provider.id, type, body.startsAt, timezone);
      const booked = await this.protectSlot(() =>
        records.insert<AppointmentRow>('appointments', {
          ...slot,
          clientId: client.id,
          clientName: client.displayName.slice(0, 200),
          providerMembershipId: provider.id,
          providerName: provider.name,
          typeId: type.id,
          typeName: type.name,
          bufferBeforeMinutes: type.bufferBeforeMinutes,
          bufferAfterMinutes: type.bufferAfterMinutes,
          timezone,
          method: body.method,
          status: 'BOOKED',
          version: 1,
          createdByUserId: ctx.userId,
        }),
      );
      await this.historyWrite(records, ctx, booked, 'BOOKED');
      await this.jobs.schedule(tx, records, booked, 'BOOKED');
      return booked;
    });
    await this.audit.log('appointment.booked', { type: 'appointment', id: row.id });
    return appointmentDto(row);
  }
  async change(
    id: string,
    body:
      | { expectedVersion: number; startsAt?: string; reason?: string }
      | UpdateFirmAppointmentDetailsRequest,
    action: 'RESCHEDULED' | 'CANCELLED' | 'DETAILS_UPDATED',
  ) {
    const row = await this.scoped(true, async (tx, records, ctx, actor, timezone) => {
      const previous = await records.one<AppointmentRow>('appointments', id),
        client = await this.visible(tx, ctx, actor, previous);
      if (actor.role === 'STAFF' && client.assignedUserId !== ctx.userId) throw missing();
      // Cancellation/details remain possible after a provider leaves; only rescheduling
      // needs an active provider. The record FK and visible() already prove firm ownership.
      if (action === 'RESCHEDULED')
        await this.provider(tx, ctx, actor, previous.providerMembershipId);
      await this.lockProvider(tx, ctx.businessId, previous.providerMembershipId);
      if (action === 'CANCELLED' && previous.status === 'CANCELLED') return previous;
      if (previous.version !== body.expectedVersion)
        throw conflict('STALE_VERSION', 'Appointment has changed');
      if (previous.status !== 'BOOKED')
        throw conflict('INVALID_STATE', 'Appointment is no longer booked');
      if (actor.role === 'CLIENT' && new Date(previous.startsAt).getTime() <= Date.now())
        throw conflict('CHANGE_WINDOW_CLOSED', 'The appointment has already started');
      let updates: Record<string, unknown> = {
        version: previous.version + 1,
        updatedAt: new Date().toISOString(),
      };
      if (action === 'RESCHEDULED') {
        await this.ensureExclusion(tx);
        await this.type(records, previous.typeId, actor);
        const startsAt = 'startsAt' in body ? body.startsAt : undefined;
        if (!startsAt)
          throw new BadRequestException({ code: 'INVALID_REQUEST', message: 'Start required' });
        const slot = await this.freeSlot(
          records,
          previous.providerMembershipId,
          {
            durationMinutes:
              (new Date(previous.endsAt).getTime() - new Date(previous.startsAt).getTime()) /
              MINUTE,
            bufferBeforeMinutes: previous.bufferBeforeMinutes,
            bufferAfterMinutes: previous.bufferAfterMinutes,
          },
          startsAt,
          timezone,
          id,
        );
        updates = { ...updates, ...slot, timezone };
      } else if (action === 'CANCELLED') updates.status = 'CANCELLED';
      else {
        if (actor.role === 'CLIENT') throw denied();
        if ('meetingUrl' in body && body.meetingUrl) {
          const url = new URL(body.meetingUrl);
          if (url.protocol !== 'https:' || url.username || url.password)
            throw new BadRequestException({
              code: 'UNSAFE_URL',
              message: 'Use an HTTPS meeting URL without credentials',
            });
        }
        for (const key of ['location', 'meetingUrl', 'instructions'] as const)
          if (key in body) updates[key] = (body as UpdateFirmAppointmentDetailsRequest)[key];
      }
      const changed = await this.protectSlot(() =>
        records.patch<AppointmentRow>('appointments', id, updates),
      );
      await this.historyWrite(
        records,
        ctx,
        changed,
        action,
        previous,
        'reason' in body ? body.reason : undefined,
      );
      await this.jobs.schedule(tx, records, changed, action);
      return changed;
    });
    await this.audit.log(`appointment.${action.toLowerCase()}`, { type: 'appointment', id });
    return appointmentDto(row);
  }
  async history(id: string, query: { cursor?: string; limit: number }) {
    const ctx = firmContext(),
      filters = { module: 'appointment-history', id },
      cursor = decodeCursor(query.cursor, ctx, filters);
    const rows = await this.scoped(false, async (tx, records, scope, actor) => {
      await this.visible(tx, scope, actor, await records.one<AppointmentRow>('appointments', id));
      return records.many<FirmAppointmentHistory>(
        'appointment_histories',
        Prisma.sql`AND appointment_id=${id}::uuid ${cursor ? Prisma.sql`AND (created_at,id)<(${cursor.createdAt},${cursor.id}::uuid)` : Prisma.empty}`,
        Prisma.sql`created_at DESC,id DESC`,
        query.limit + 1,
      );
    });
    const items = rows.slice(0, query.limit);
    await this.audit.log('appointment.history_viewed', { type: 'appointment', id });
    return ListFirmAppointmentHistoryResponse.parse({
      items: items.map((row) => project(FirmAppointmentHistory, row)),
      nextCursor: rows.length > query.limit ? encodeCursor(ctx, filters, items.at(-1)!) : null,
    });
  }
}
