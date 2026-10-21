import { Inject, Injectable } from '@nestjs/common';
import type { Database, TxClient } from '@firmivra/db';
import type { LocationAction, LocationHoursInterval, LocationProfile } from '@firmivra/types';
import { timeOfDayFromDb, timeOfDayToDb, usableTimeZone } from '../appointments/calendar.js';
import { firmTimeZone } from '../appointments/calendar-data.js';
import { AuditService } from '../audit/audit.service.js';
import type { TenantContext } from '../common/request-context.js';
import { DATABASE } from '../database/database.module.js';
import { MemberChanged } from '../staff/staff-actions.service.js';
import { assertManages } from '../staff/staff.common.js';
import { notFound } from '../workspaces/common.js';
import {
  type ActionRow,
  applyAction,
  dbNow,
  finishDone,
  insertAction,
  lockLocations,
  noPending,
} from './location-actions.js';
import {
  conflict,
  errors,
  invalid,
  mapLocationDbError,
  MAX_SCHEDULE_MS,
  overAllowance,
  whenOf,
} from './locations-common.js';
import type {
  CreateLocationBody,
  DeactivateLocationBody,
  DeactivateManagerBody,
  Out,
  ReassignManagerBody,
  SetLocationStaffBody,
  UpdateLocationActionBody,
  UpdateLocationBody,
} from './locations-input.js';
import {
  actionsOf,
  activeCount,
  allowedOf,
  liveOffice,
  LocationsReadService,
  type ProfileDraft,
} from './locations-read.service.js';

// Settings > Locations' changes (contract: packages/types/src/settings/locations.ts). Owner and
// Admin; deactivating a location or a manager and editing or cancelling a scheduled change are the
// Super Administrator's (the Owner, or an Admin with MANAGE on SETTINGS). Every change runs under
// the firm's Locations lock, in its business scope, with an audit row (ids and field names only).
// Locations are never deleted. The database's refusals come back as the contract's errors.

type Fields = Out<typeof CreateLocationBody> | Out<typeof UpdateLocationBody>;
type Hours = readonly LocationHoursInterval[];

const hoursKey = (hours: Hours) =>
  hours
    .map((h) => `${h.weekday}:${h.opensAt}-${h.closesAt}`)
    .sort()
    .join(',');

@Injectable()
export class LocationsService {
  constructor(
    @Inject(DATABASE) private readonly database: Database,
    private readonly audit: AuditService,
    private readonly reads: LocationsReadService,
  ) {}

  /** A change: the firm's Locations lock, then the work; the database's refusals mapped. */
  private async write<T>(businessId: string, fn: (tx: TxClient) => Promise<T>): Promise<T> {
    try {
      return await this.database.withScope({ kind: 'business', businessId }, async (tx) => {
        await lockLocations(tx, businessId);
        return fn(tx);
      });
    } catch (e) {
      if (e instanceof MemberChanged)
        throw conflict(
          'CONFLICT',
          'This person was just changed by someone else. Reload and try again.',
        );
      throw mapLocationDbError(e);
    }
  }

  /** A change that answers with the location's profile. */
  private async writeProfile(
    businessId: string,
    fn: (tx: TxClient) => Promise<string>,
  ): Promise<LocationProfile> {
    const draft: ProfileDraft = await this.write(businessId, async (tx) =>
      this.reads.profileIn(tx, businessId, await fn(tx)),
    );
    return this.reads.withPhoto(draft);
  }

  /** 403 FORBIDDEN unless the viewer is a Super Administrator. */
  private async superAdministrator(tenant: TenantContext, userId: string): Promise<void> {
    if (!(await this.reads.canManageSchedules(tenant, userId))) throw errors.forbidden();
  }

  // ---------- Checks ----------

  /** The manager-to-be: an ACTIVE member of the firm (400 MANAGER_NOT_ELIGIBLE). */
  private async eligible(tx: TxClient, businessId: string, userId: string, path: string) {
    const m = await tx.membership.findFirst({
      where: { businessId, userId, status: 'ACTIVE' },
      select: { userId: true },
    });
    if (!m) throw errors.notEligible(path);
  }

  /**
   * Assigned Staff: active members, or members already assigned here who are not deactivated (a
   * locked member stays on the list). A deactivated member's row is kept and never shown.
   */
  private async checkStaff(
    tx: TxClient,
    businessId: string,
    userIds: readonly string[],
    officeId: string | null,
  ) {
    if (!userIds.length) return;
    const [active, assigned] = await Promise.all([
      tx.membership.findMany({
        where: { businessId, userId: { in: [...userIds] }, status: 'ACTIVE' },
        select: { userId: true },
      }),
      officeId
        ? tx.firmOfficeMember.findMany({
            where: {
              businessId,
              officeId,
              userId: { in: [...userIds] },
              member: { status: { not: 'DEACTIVATED' } },
            },
            select: { userId: true },
          })
        : Promise.resolve([]),
    ]);
    const ok = new Set([...active, ...assigned].map((m) => m.userId));
    const bad = userIds.findIndex((id) => !ok.has(id));
    if (bad >= 0) throw invalid(`staffUserIds.${bad}`, 'Choose active members of the firm');
  }

  /** Services & Pricing's live ACTIVE services only. */
  private async checkServices(tx: TxClient, businessId: string, serviceIds: readonly string[]) {
    if (!serviceIds.length) return;
    const found = await tx.service.findMany({
      where: { businessId, id: { in: [...serviceIds] }, archivedAt: null, status: 'ACTIVE' },
      select: { id: true },
    });
    const ok = new Set(found.map((s) => s.id));
    const bad = serviceIds.findIndex((id) => !ok.has(id));
    if (bad >= 0) throw invalid(`serviceIds.${bad}`, 'Choose a service from Services & Pricing');
  }

  /** The location's own time zone; the firm's (or none) is kept empty so the firm's applies. */
  private async zoneOf(tx: TxClient, businessId: string, zone: string | null | undefined) {
    if (zone === undefined || zone === null) return null;
    if (!/^[A-Za-z_]+(\/[A-Za-z0-9_+-]+){1,2}$/.test(zone) || usableTimeZone(zone) !== zone)
      throw invalid('timeZone', 'Choose a valid time zone');
    return zone === (await firmTimeZone(tx, businessId)) ? null : zone;
  }

  /**
   * "This location already exists" (Locations guide, final decision 5): another live location
   * with the same name (case and edge spaces aside) or the same address (the database's own
   * normalised key: case, punctuation and spaces aside, the ZIP's first 5 digits). The same EIN or
   * business name alone never blocks. The unique indexes stay the last word on a race.
   */
  private async notDuplicate(
    tx: TxClient,
    businessId: string,
    v: Fields,
    except: string | null,
  ): Promise<void> {
    const found = await tx.$queryRaw<{ id: string }[]>`
      SELECT id FROM firm_offices
      WHERE business_id = ${businessId}::uuid AND archived_at IS NULL
        AND (${except}::uuid IS NULL OR id <> ${except}::uuid)
        AND (lower(btrim(name)) = lower(btrim(${v.name}::text))
          OR (address_key IS NOT NULL AND address_key = app_address_key(
            ${v.addressLine1 ?? null}::text, ${v.addressLine2 ?? null}::text, ${v.city ?? null}::text,
            ${v.state ?? null}::text, ${v.postalCode ?? null}::text)))
      LIMIT 1`;
    if (found.length) throw errors.duplicate();
  }

  /** One more ACTIVE location must fit the plan (409 LOCATION_LIMIT). */
  private async fitsPlan(tx: TxClient, businessId: string) {
    const [active, allowed] = await Promise.all([
      activeCount(tx, businessId),
      allowedOf(tx, businessId),
    ]);
    if (overAllowance(active, allowed)) throw errors.limit();
  }

  // ---------- The sets: services, hours, staff ----------

  /** The location's live ACTIVE services become `ids`; links to retired services stay, unseen. */
  private async setServices(
    tx: TxClient,
    businessId: string,
    officeId: string,
    ids: readonly string[],
  ): Promise<boolean> {
    const current = await tx.firmOfficeService.findMany({
      where: { businessId, officeId },
      select: { serviceId: true, service: { select: { archivedAt: true, status: true } } },
    });
    const wanted = new Set(ids);
    const have = new Set(current.map((c) => c.serviceId));
    const remove = current
      .filter((c) => c.service.archivedAt === null && c.service.status === 'ACTIVE')
      .map((c) => c.serviceId)
      .filter((id) => !wanted.has(id));
    const add = ids.filter((id) => !have.has(id));
    if (remove.length)
      await tx.firmOfficeService.deleteMany({
        where: { businessId, officeId, serviceId: { in: remove } },
      });
    if (add.length)
      await tx.firmOfficeService.createMany({
        data: add.map((serviceId) => ({ businessId, officeId, serviceId })),
      });
    return remove.length + add.length > 0;
  }

  private async setHours(
    tx: TxClient,
    businessId: string,
    officeId: string,
    hours: Hours,
  ): Promise<boolean> {
    const current = await tx.firmOfficeHours.findMany({ where: { businessId, officeId } });
    const before = hoursKey(
      current.map((h) => ({
        weekday: h.weekday,
        opensAt: timeOfDayFromDb(h.opensAt),
        closesAt: timeOfDayFromDb(h.closesAt),
      })),
    );
    if (before === hoursKey(hours)) return false;
    await tx.firmOfficeHours.deleteMany({ where: { businessId, officeId } });
    if (hours.length)
      await tx.firmOfficeHours.createMany({
        data: hours.map((h) => ({
          businessId,
          officeId,
          weekday: h.weekday,
          opensAt: timeOfDayToDb(h.opensAt),
          closesAt: timeOfDayToDb(h.closesAt),
        })),
      });
    return true;
  }

  /** Assigned Staff becomes `userIds`; a deactivated member's row stays (history), unseen. */
  private async setMembers(
    tx: TxClient,
    businessId: string,
    officeId: string,
    userIds: readonly string[],
  ): Promise<{ added: number; removed: number }> {
    const current = await tx.firmOfficeMember.findMany({
      where: { businessId, officeId },
      select: { userId: true, member: { select: { status: true } } },
    });
    const wanted = new Set(userIds);
    const have = new Set(current.map((c) => c.userId));
    const remove = current
      .filter((c) => c.member.status !== 'DEACTIVATED' && !wanted.has(c.userId))
      .map((c) => c.userId);
    const add = userIds.filter((id) => !have.has(id));
    if (remove.length)
      await tx.firmOfficeMember.deleteMany({
        where: { businessId, officeId, userId: { in: remove } },
      });
    if (add.length)
      await tx.firmOfficeMember.createMany({
        data: add.map((userId) => ({ businessId, officeId, userId })),
      });
    return { added: add.length, removed: remove.length };
  }

  // ---------- Add, Edit, Primary, Activate, Staff ----------

  create(
    tenant: TenantContext,
    userId: string,
    body: Out<typeof CreateLocationBody>,
  ): Promise<LocationProfile> {
    const { businessId } = tenant;
    return this.writeProfile(businessId, async (tx) => {
      await this.eligible(tx, businessId, body.managerUserId, 'managerUserId');
      await this.checkStaff(tx, businessId, body.staffUserIds, null);
      await this.checkServices(tx, businessId, body.serviceIds);
      const timeZone = await this.zoneOf(tx, businessId, body.timeZone);
      await this.notDuplicate(tx, businessId, body, null);
      if (body.status === 'ACTIVE') await this.fitsPlan(tx, businessId);
      if (body.isMain)
        await tx.firmOffice.updateMany({
          where: { businessId, isMain: true, archivedAt: null },
          data: { isMain: false },
        });
      const office = await tx.firmOffice.create({
        data: {
          businessId,
          name: body.name,
          kind: body.kind,
          status: body.status,
          isMain: body.isMain,
          addressLine1: body.addressLine1 ?? null,
          addressLine2: body.addressLine2 ?? null,
          city: body.city ?? null,
          state: body.state ?? null,
          postalCode: body.postalCode ?? null,
          phone: body.phone,
          alternatePhone: body.alternatePhone ?? null,
          email: body.email,
          timeZone,
          notes: body.notes ?? null,
          managerUserId: body.managerUserId,
        },
        select: { id: true },
      });
      await this.setServices(tx, businessId, office.id, body.serviceIds);
      await this.setHours(tx, businessId, office.id, body.hours);
      await this.setMembers(tx, businessId, office.id, body.staffUserIds);
      await this.audit.logIn(
        tx,
        'firm_office.created',
        { type: 'firm_office', id: office.id },
        {
          officeId: office.id,
          kind: body.kind,
          status: body.status,
          isMain: body.isMain,
          services: body.serviceIds.length,
          hours: body.hours.length,
          staff: body.staffUserIds.length,
        },
        { businessId },
      );
      return office.id;
    });
  }

  update(
    tenant: TenantContext,
    id: string,
    body: Out<typeof UpdateLocationBody>,
  ): Promise<LocationProfile> {
    const { businessId } = tenant;
    return this.writeProfile(businessId, async (tx) => {
      const office = await liveOffice(tx, businessId, id);
      await this.checkStaff(tx, businessId, body.staffUserIds, office.id);
      await this.checkServices(tx, businessId, body.serviceIds);
      const timeZone = await this.zoneOf(tx, businessId, body.timeZone);
      if (office.updatedAt.getTime() !== Date.parse(body.expectedUpdatedAt))
        throw errors.saveConflict();
      await this.notDuplicate(tx, businessId, body, office.id);
      const next = {
        name: body.name,
        kind: body.kind,
        addressLine1: body.addressLine1 ?? null,
        addressLine2: body.addressLine2 ?? null,
        city: body.city ?? null,
        state: body.state ?? null,
        postalCode: body.postalCode ?? null,
        phone: body.phone,
        alternatePhone: body.alternatePhone ?? null,
        email: body.email,
        timeZone,
        notes: body.notes ?? null,
      };
      const fields: string[] = (Object.keys(next) as (keyof typeof next)[]).filter(
        (k) => next[k] !== office[k],
      );
      // Always written: the new updatedAt is the next save's version.
      await tx.firmOffice.update({ where: { id: office.id }, data: next });
      if (await this.setServices(tx, businessId, office.id, body.serviceIds))
        fields.push('services');
      if (await this.setHours(tx, businessId, office.id, body.hours)) fields.push('hours');
      const staff = await this.setMembers(tx, businessId, office.id, body.staffUserIds);
      if (staff.added + staff.removed > 0) fields.push('staff');
      await this.audit.logIn(
        tx,
        'firm_office.updated',
        { type: 'firm_office', id: office.id },
        { officeId: office.id, fields },
        { businessId },
      );
      return office.id;
    });
  }

  /** Set as Primary: an ACTIVE location; the old primary stays, not primary. */
  setPrimary(tenant: TenantContext, id: string): Promise<LocationProfile> {
    const { businessId } = tenant;
    return this.writeProfile(businessId, async (tx) => {
      const office = await liveOffice(tx, businessId, id);
      if (office.isMain) return office.id;
      if (office.status !== 'ACTIVE')
        throw invalid('status', 'Activate the location before making it the primary location');
      const old = await tx.firmOffice.findFirst({
        where: { businessId, isMain: true, archivedAt: null },
        select: { id: true },
      });
      await tx.firmOffice.updateMany({
        where: { businessId, isMain: true, archivedAt: null },
        data: { isMain: false },
      });
      await tx.firmOffice.update({ where: { id: office.id }, data: { isMain: true } });
      await this.audit.logIn(
        tx,
        'firm_office.primary_set',
        { type: 'firm_office', id: office.id },
        { officeId: office.id, previousId: old?.id ?? null },
        { businessId },
      );
      return office.id;
    });
  }

  /** Activate: 409 LOCATION_LIMIT when the plan's locations are in use. Repeating is harmless. */
  activate(tenant: TenantContext, id: string): Promise<LocationProfile> {
    const { businessId } = tenant;
    return this.writeProfile(businessId, async (tx) => {
      const office = await liveOffice(tx, businessId, id);
      if (office.status === 'ACTIVE') return office.id;
      await this.fitsPlan(tx, businessId);
      await tx.firmOffice.update({ where: { id: office.id }, data: { status: 'ACTIVE' } });
      await this.audit.logIn(
        tx,
        'firm_office.activated',
        { type: 'firm_office', id: office.id },
        { officeId: office.id },
        { businessId },
      );
      return office.id;
    });
  }

  /** Manage Staff: who works there (replaces the set). */
  setStaff(
    tenant: TenantContext,
    id: string,
    body: Out<typeof SetLocationStaffBody>,
  ): Promise<LocationProfile> {
    const { businessId } = tenant;
    return this.writeProfile(businessId, async (tx) => {
      const office = await liveOffice(tx, businessId, id);
      await this.checkStaff(tx, businessId, body.staffUserIds, office.id);
      const { added, removed } = await this.setMembers(
        tx,
        businessId,
        office.id,
        body.staffUserIds,
      );
      // The Edit form saves Assigned Staff too: its next save must see this one.
      await tx.firmOffice.update({ where: { id: office.id }, data: { updatedAt: new Date() } });
      await this.audit.logIn(
        tx,
        'firm_office.staff_set',
        { type: 'firm_office', id: office.id },
        { officeId: office.id, added, removed, count: body.staffUserIds.length },
        { businessId },
      );
      return office.id;
    });
  }

  // ---------- Now or later: deactivate, reassign, deactivate a manager ----------

  /** Runs a change at once: its row PENDING at the database's now, then DONE, both audited. */
  private async runNow(
    tx: TxClient,
    businessId: string,
    userId: string,
    data: Omit<Parameters<typeof insertAction>[2], 'effectiveAt' | 'createdByUserId'>,
  ): Promise<ActionRow> {
    const action = await insertAction(tx, businessId, {
      ...data,
      effectiveAt: await dbNow(tx),
      createdByUserId: userId,
    });
    await applyAction(tx, this.audit, businessId, action);
    return finishDone(tx, this.audit, businessId, action, true);
  }

  /** Schedules a change for later: PENDING, audited. */
  private async schedule(
    tx: TxClient,
    businessId: string,
    userId: string,
    at: Date,
    data: Omit<Parameters<typeof insertAction>[2], 'effectiveAt' | 'createdByUserId'>,
  ): Promise<ActionRow> {
    const action = await insertAction(tx, businessId, {
      ...data,
      effectiveAt: at,
      createdByUserId: userId,
    });
    await this.audit.logIn(
      tx,
      'firm_office_action.scheduled',
      { type: 'firm_office_action', id: action.id },
      {
        actionId: action.id,
        kind: action.kind,
        officeId: action.officeId,
        effectiveAt: at.toISOString(),
      },
      { businessId },
    );
    return action;
  }

  /**
   * Deactivate Location (Super Administrator), now or later. The main location never (409
   * LOCATION_IS_PRIMARY); one pending change per location (409 PENDING_ACTION_EXISTS). Its
   * appointments, staff and their accounts stay. Deactivating an inactive location now changes
   * nothing.
   */
  async deactivate(
    tenant: TenantContext,
    userId: string,
    id: string,
    body: Out<typeof DeactivateLocationBody>,
  ): Promise<LocationProfile> {
    await this.superAdministrator(tenant, userId);
    const { businessId } = tenant;
    return this.writeProfile(businessId, async (tx) => {
      const office = await liveOffice(tx, businessId, id);
      if (office.isMain) throw errors.isPrimary();
      const when = whenOf(body.effectiveAt, Date.now());
      if ('now' in when && office.status === 'INACTIVE') return office.id;
      if ('at' in when && office.status === 'INACTIVE')
        throw invalid('effectiveAt', 'This location is already inactive');
      await noPending(tx, businessId, { officeId: office.id });
      const data = {
        kind: 'DEACTIVATE_LOCATION' as const,
        officeId: office.id,
        managerUserId: null,
        newManagerUserId: null,
      };
      if ('now' in when) await this.runNow(tx, businessId, userId, data);
      else await this.schedule(tx, businessId, userId, when.at, data);
      return office.id;
    });
  }

  /**
   * Reassign Manager, now or later (Owner and Admin): an ACTIVE member, not the current manager.
   * One pending change per location, and none while the current or the new manager's
   * deactivation is pending (409 PENDING_ACTION_EXISTS).
   */
  reassignManager(
    tenant: TenantContext,
    userId: string,
    id: string,
    body: Out<typeof ReassignManagerBody>,
  ): Promise<LocationProfile> {
    const { businessId } = tenant;
    return this.writeProfile(businessId, async (tx) => {
      const office = await liveOffice(tx, businessId, id);
      await this.eligible(tx, businessId, body.managerUserId, 'managerUserId');
      if (body.managerUserId === office.managerUserId)
        throw invalid('managerUserId', 'This person already manages this location');
      const when = whenOf(body.effectiveAt, Date.now());
      await noPending(tx, businessId, { officeId: office.id });
      await noPending(tx, businessId, {
        kind: 'DEACTIVATE_MANAGER',
        managerUserId: {
          in: [office.managerUserId, body.managerUserId].filter((u): u is string => !!u),
        },
      });
      const data = {
        kind: 'REASSIGN_MANAGER' as const,
        officeId: office.id,
        managerUserId: office.managerUserId,
        newManagerUserId: body.managerUserId,
      };
      if ('now' in when) await this.runNow(tx, businessId, userId, data);
      else await this.schedule(tx, businessId, userId, when.at, data);
      return office.id;
    });
  }

  /**
   * Deactivate Manager (Super Administrator), now or later: the member's locations get
   * `replacementUserId` (an ACTIVE member) or, with null, the main location's manager acts; their
   * firm access ends as Staff Management's Deactivate ends it (open invite revoked, sessions
   * signed out). Only roles the actor manages (an Admin never deactivates an Admin or the Owner),
   * never themselves. No conflicting pending change for the manager or the replacement: their own
   * deactivation, or a reassignment of a location they run or would take over.
   */
  async deactivateManager(
    tenant: TenantContext,
    userId: string,
    managerUserId: string,
    body: Out<typeof DeactivateManagerBody>,
  ): Promise<LocationAction> {
    await this.superAdministrator(tenant, userId);
    const { businessId } = tenant;
    if (tenant.kind !== 'staff') throw errors.forbidden();
    const role = tenant.role;
    const row = await this.write(businessId, async (tx) => {
      const target = await tx.membership.findFirst({
        where: { businessId, userId: managerUserId },
        select: { id: true, userId: true, role: true, status: true },
      });
      if (!target) throw notFound();
      assertManages({ businessId, userId, role }, target);
      const replacement = body.replacementUserId;
      if (replacement !== null) {
        await this.eligible(tx, businessId, replacement, 'replacementUserId');
        if (replacement === managerUserId)
          throw invalid('replacementUserId', 'Choose someone other than the manager');
      }
      const when = whenOf(body.effectiveAt, Date.now());
      if ('at' in when && target.status === 'DEACTIVATED')
        throw invalid('effectiveAt', 'This person is already deactivated');
      const people = [managerUserId, ...(replacement ? [replacement] : [])];
      await noPending(tx, businessId, {
        kind: 'DEACTIVATE_MANAGER',
        managerUserId: { in: people },
      });
      await noPending(tx, businessId, {
        kind: 'DEACTIVATE_MANAGER',
        newManagerUserId: managerUserId,
      });
      await noPending(tx, businessId, {
        kind: 'REASSIGN_MANAGER',
        OR: [
          { managerUserId },
          { newManagerUserId: managerUserId },
          { office: { is: { managerUserId } } },
        ],
      });
      const data = {
        kind: 'DEACTIVATE_MANAGER' as const,
        officeId: null,
        managerUserId,
        newManagerUserId: replacement,
      };
      const action =
        'now' in when
          ? await this.runNow(tx, businessId, userId, data)
          : await this.schedule(tx, businessId, userId, when.at, data);
      return (await actionsOf(tx, businessId, [action]))[0] as LocationAction;
    });
    return row;
  }

  // ---------- Scheduled changes: Edit Schedule, Cancel Schedule ----------

  private async pendingAction(tx: TxClient, businessId: string, id: string): Promise<ActionRow> {
    const action = await tx.firmOfficeAction.findFirst({ where: { businessId, id } });
    if (!action) throw notFound();
    if (action.status !== 'PENDING') throw errors.actionFinished();
    return action;
  }

  /**
   * Edit Schedule (Super Administrator, while PENDING): a new time (in the future, at most a year
   * ahead) and the new manager (REASSIGN_MANAGER: an ACTIVE member; DEACTIVATE_MANAGER: one, or
   * null for the acting fallback). The first time is kept by the database.
   */
  async updateAction(
    tenant: TenantContext,
    userId: string,
    id: string,
    body: Out<typeof UpdateLocationActionBody>,
  ): Promise<LocationAction> {
    await this.superAdministrator(tenant, userId);
    const { businessId } = tenant;
    return this.write(businessId, async (tx) => {
      const action = await this.pendingAction(tx, businessId, id);
      const data: { effectiveAt?: Date; newManagerUserId?: string | null } = {};
      if (body.effectiveAt !== undefined) {
        const at = Date.parse(body.effectiveAt);
        const now = Date.now();
        if (at <= now) throw invalid('effectiveAt', 'Choose a time in the future');
        if (at - now > MAX_SCHEDULE_MS)
          throw invalid('effectiveAt', 'Choose a time within the next year');
        data.effectiveAt = new Date(at);
      }
      if (body.newManagerUserId !== undefined) {
        const next = body.newManagerUserId;
        if (action.kind === 'DEACTIVATE_LOCATION')
          throw invalid('newManagerUserId', 'A location deactivation has no new manager');
        if (next === null && action.kind === 'REASSIGN_MANAGER')
          throw invalid('newManagerUserId', 'Choose the new manager');
        if (next !== null) {
          await this.eligible(tx, businessId, next, 'newManagerUserId');
          if (next === action.managerUserId)
            throw invalid('newManagerUserId', 'Choose someone other than the current manager');
          await noPending(tx, businessId, { kind: 'DEACTIVATE_MANAGER', managerUserId: next }, id);
        }
        data.newManagerUserId = next;
      }
      const saved = await tx.firmOfficeAction.update({
        where: { id: action.id },
        data: { ...data, updatedByUserId: userId },
      });
      await this.audit.logIn(
        tx,
        'firm_office_action.updated',
        { type: 'firm_office_action', id: action.id },
        {
          actionId: action.id,
          kind: action.kind,
          officeId: action.officeId,
          fields: Object.keys(data),
          effectiveAt: saved.effectiveAt.toISOString(),
        },
        { businessId },
      );
      return (await actionsOf(tx, businessId, [saved]))[0] as LocationAction;
    });
  }

  /** Cancel Schedule (Super Administrator, while PENDING): CANCELLED, never runs. */
  async cancelAction(tenant: TenantContext, userId: string, id: string): Promise<LocationAction> {
    await this.superAdministrator(tenant, userId);
    const { businessId } = tenant;
    return this.write(businessId, async (tx) => {
      const action = await this.pendingAction(tx, businessId, id);
      const saved = await tx.firmOfficeAction.update({
        where: { id: action.id },
        data: { status: 'CANCELLED', updatedByUserId: userId },
      });
      await this.audit.logIn(
        tx,
        'firm_office_action.cancelled',
        { type: 'firm_office_action', id: action.id },
        { actionId: action.id, kind: action.kind, officeId: action.officeId },
        { businessId },
      );
      return (await actionsOf(tx, businessId, [saved]))[0] as LocationAction;
    });
  }
}
