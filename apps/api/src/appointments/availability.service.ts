import { Inject, Injectable } from '@nestjs/common';
import type { Database, Prisma, TxClient } from '@firmivra/db';
import type {
  Availability,
  BlockedTime,
  BlockedTimesQuery,
  CreateBlockedTimeRequest,
  MemberAvailability,
  SetWorkingHoursRequest,
} from '@firmivra/types';
import type { z } from 'zod';
import { AuditService } from '../audit/audit.service.js';
import { DATABASE } from '../database/database.module.js';
import { timeOfDayToDb } from './calendar.js';
import {
  activeMember,
  activeMembers,
  type FirmActor,
  firmTimeZone,
  memberNames,
  workingHours,
} from './calendar-data.js';
import { lockForBlock, retryWhenBusy, tryLock, workingHoursLockKey } from './calendar-locks.js';
import { errors } from './errors.js';

type BlocksQuery = z.output<typeof BlockedTimesQuery>;
type BlockBody = z.output<typeof CreateBlockedTimeRequest>;
type HoursBody = z.output<typeof SetWorkingHoursRequest>;

const blockSelect = {
  id: true,
  userId: true,
  startsAt: true,
  endsAt: true,
  reason: true,
  createdByUserId: true,
} satisfies Prisma.BlockedTimeSelect;

type BlockRow = Prisma.BlockedTimeGetPayload<{ select: typeof blockSelect }>;

function toBlockedTime(row: BlockRow, names: ReadonlyMap<string, string>): BlockedTime {
  const name = (userId: string) => names.get(userId) ?? 'Former member';
  return {
    id: row.id,
    member: row.userId ? { userId: row.userId, name: name(row.userId) } : null,
    startsAt: row.startsAt.toISOString(),
    endsAt: row.endsAt.toISOString(),
    reason: row.reason,
    createdBy: row.createdByUserId
      ? { userId: row.createdByUserId, name: name(row.createdByUserId) }
      : null,
  };
}

/** Owner and Admin change anyone's; Staff only their own (a whole-firm block is a manager's). */
function mayChange(actor: FirmActor, userId: string | null): void {
  if (actor.role === 'STAFF' && userId !== actor.userId) throw errors.forbidden();
}

/**
 * Working hours and blocked time (contract in packages/types/src/appointments). Everyone at the
 * firm reads; Owner and Admin change anyone's and whole-firm blocks, Staff their own. A block
 * may not cover a scheduled appointment (409 BLOCKS_APPOINTMENT). Changes are audited with ids
 * and times only, never the reason's text.
 */
@Injectable()
export class AvailabilityService {
  constructor(
    @Inject(DATABASE) private readonly database: Database,
    private readonly audit: AuditService,
  ) {}

  /** One transaction in the firm's scope, tried again while a lock it needs is busy. */
  private inFirm<T>(businessId: string, fn: (tx: TxClient) => Promise<T>): Promise<T> {
    return retryWhenBusy(() => this.database.withScope({ kind: 'business', businessId }, fn));
  }

  async get(businessId: string): Promise<Availability> {
    return this.inFirm(businessId, async (tx) => {
      const members = await activeMembers(tx, businessId);
      const hours = await workingHours(
        tx,
        businessId,
        members.map((m) => m.userId),
      );
      return {
        timezone: await firmTimeZone(tx, businessId),
        members: members.map((member) => ({ member, hours: hours.get(member.userId) ?? [] })),
      };
    });
  }

  /** Replaces the member's whole week. */
  async setWorkingHours(
    businessId: string,
    actor: FirmActor,
    userId: string,
    body: HoursBody,
  ): Promise<MemberAvailability> {
    mayChange(actor, userId);
    const result = await this.inFirm(businessId, async (tx) => {
      const member = await activeMember(tx, businessId, userId);
      // Two replacements at once must not leave the union of both weeks.
      await tryLock(tx, workingHoursLockKey(businessId, userId));
      await tx.workingHours.deleteMany({ where: { businessId, userId } });
      if (body.hours.length > 0) {
        await tx.workingHours.createMany({
          data: body.hours.map((h) => ({
            businessId,
            userId,
            weekday: h.weekday,
            startsAt: timeOfDayToDb(h.startsAt),
            endsAt: timeOfDayToDb(h.endsAt),
          })),
        });
      }
      const hours = await workingHours(tx, businessId, [userId]);
      return { member, hours: hours.get(userId) ?? [] };
    });
    await this.audit.log(
      'working_hours.set',
      { type: 'working_hours', id: userId },
      { ranges: result.hours.length },
    );
    return result;
  }

  /** Blocks touching [from, to); with `userId`, that member's and the whole firm's. */
  async blockedTimes(businessId: string, q: BlocksQuery): Promise<BlockedTime[]> {
    return this.inFirm(businessId, async (tx) => {
      const rows = await tx.blockedTime.findMany({
        where: {
          businessId,
          startsAt: { lt: new Date(q.to) },
          endsAt: { gt: new Date(q.from) },
          ...(q.userId ? { OR: [{ userId: q.userId }, { userId: null }] } : {}),
        },
        orderBy: [{ startsAt: 'asc' }, { id: 'asc' }],
        select: blockSelect,
      });
      const names = await memberNames(
        tx,
        businessId,
        rows.flatMap((r) => [r.userId, r.createdByUserId]).filter((id): id is string => !!id),
      );
      return rows.map((r) => toBlockedTime(r, names));
    });
  }

  async block(businessId: string, actor: FirmActor, body: BlockBody): Promise<BlockedTime> {
    mayChange(actor, body.userId);
    const startsAt = new Date(body.startsAt);
    const endsAt = new Date(body.endsAt);
    const row = await this.inFirm(businessId, async (tx) => {
      if (body.userId) await activeMember(tx, businessId, body.userId);
      // Bookings for this member (or, for a whole-firm block, any booking) hold the same key
      // shared, so a booking and a block can never both pass their checks (calendar-locks.ts).
      await lockForBlock(tx, businessId, body.userId);
      const covered = await tx.appointment.findFirst({
        where: {
          businessId,
          status: 'SCHEDULED',
          startsAt: { lt: endsAt },
          endsAt: { gt: startsAt },
          ...(body.userId ? { staffUserId: body.userId } : {}),
        },
        select: { id: true },
      });
      if (covered) throw errors.blocksAppointment();
      const created = await tx.blockedTime.create({
        data: {
          businessId,
          userId: body.userId,
          startsAt,
          endsAt,
          reason: body.reason ?? null,
          createdByUserId: actor.userId,
        },
        select: blockSelect,
      });
      const ids = [created.userId, created.createdByUserId].filter((id): id is string => !!id);
      return toBlockedTime(created, await memberNames(tx, businessId, ids));
    });
    await this.audit.log(
      'blocked_time.created',
      { type: 'blocked_time', id: row.id },
      {
        userId: row.member?.userId ?? null,
        startsAt: row.startsAt,
        endsAt: row.endsAt,
        reasonGiven: row.reason !== null,
      },
    );
    return row;
  }

  async unblock(businessId: string, actor: FirmActor, id: string): Promise<{ ok: true }> {
    const row = await this.inFirm(businessId, async (tx) => {
      // Locked first: of two deletes at once, the second waits, then finds nothing (404).
      await tx.$executeRaw`
        SELECT 1 FROM blocked_times
        WHERE business_id = ${businessId}::uuid AND id = ${id}::uuid
        FOR UPDATE`;
      const found = await tx.blockedTime.findFirst({
        where: { businessId, id },
        select: { id: true, userId: true, startsAt: true, endsAt: true },
      });
      if (!found) throw errors.notFound();
      mayChange(actor, found.userId);
      await tx.blockedTime.deleteMany({ where: { businessId, id } });
      return found;
    });
    await this.audit.log(
      'blocked_time.deleted',
      { type: 'blocked_time', id },
      {
        userId: row.userId,
        startsAt: row.startsAt.toISOString(),
        endsAt: row.endsAt.toISOString(),
      },
    );
    return { ok: true };
  }
}
