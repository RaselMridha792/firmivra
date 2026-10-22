import { Inject, Injectable, Logger } from '@nestjs/common';
import type { Database, Prisma, TxClient } from '@firmivra/db';
import {
  ENTITY_TYPES,
  type LocationAction,
  type LocationActionList,
  type LocationActivity,
  type LocationList,
  type LocationOptions,
  type LocationPerson,
  type LocationProfile,
  type LocationRow,
  type LocationsKpis,
} from '@firmivra/types';
import { firmTimeZone } from '../appointments/calendar-data.js';
import { timeOfDayFromDb } from '../appointments/calendar.js';
import type { TenantContext } from '../common/request-context.js';
import { DATABASE } from '../database/database.module.js';
import { PermissionGrantsService } from '../roles/permission-grants.service.js';
import { activityItem, officeNamesOf } from '../settings/admin-activity.js';
import { DOCUMENT_STORAGE, type DocumentStorage, statusOf } from '../storage/document-storage.js';
import { notFound } from '../workspaces/common.js';
import {
  allowanceOf,
  isSuperAdministrator,
  kpisOf,
  type ManagerRef,
  runnerOf,
} from './locations-common.js';
import type { LocationActionsQ, LocationActivityQ, LocationsQ, Out } from './locations-input.js';

// Settings > Locations' reads (contract: packages/types/src/settings/locations.ts). Every query
// runs in the firm's business scope (RLS) and names the firm too. A location is a live
// firm_offices row (never archived by these screens).

export type OfficeRow = Prisma.FirmOfficeGetPayload<object>;
type ActionRow = Prisma.FirmOfficeActionGetPayload<object>;

export const personSelect = {
  userId: true,
  role: true,
  status: true,
  jobTitle: true,
  user: { select: { name: true, email: true, phone: true } },
} satisfies Prisma.MembershipSelect;
export type PersonRow = Prisma.MembershipGetPayload<{ select: typeof personSelect }>;

export const toPerson = (m: PersonRow): LocationPerson => ({
  userId: m.userId,
  name: m.user.name,
  jobTitle: m.jobTitle,
  email: m.user.email,
  phone: m.user.phone,
});
const formerPerson = (userId: string): LocationPerson => ({
  userId,
  name: 'Former member',
  jobTitle: null,
  email: null,
  phone: null,
});

/** The firm's members with these user ids, by user id. */
export async function peopleOf(
  tx: TxClient,
  businessId: string,
  userIds: Iterable<string | null | undefined>,
): Promise<Map<string, PersonRow>> {
  const ids = [...new Set([...userIds].filter((id): id is string => !!id))];
  if (!ids.length) return new Map();
  const rows = await tx.membership.findMany({
    where: { businessId, userId: { in: ids } },
    select: personSelect,
  });
  return new Map(rows.map((r) => [r.userId, r]));
}

/** A manager as the rules see them: deactivated, or not a member at all, counts as removed. */
const refOf = (persons: Map<string, PersonRow>, userId: string | null): ManagerRef | null =>
  userId
    ? { userId, present: (persons.get(userId)?.status ?? 'DEACTIVATED') !== 'DEACTIVATED' }
    : null;

/** The main location's manager (the acting manager of locations without one), if any. */
export async function mainManagerOf(tx: TxClient, businessId: string): Promise<string | null> {
  const main = await tx.firmOffice.findFirst({
    where: { businessId, isMain: true, archivedAt: null },
    select: { managerUserId: true },
  });
  return main?.managerUserId ?? null;
}

export function toAction(
  a: ActionRow,
  persons: Map<string, PersonRow>,
  officeNames: Map<string, string>,
): LocationAction {
  const person = (id: string | null) =>
    id ? (persons.has(id) ? toPerson(persons.get(id)!) : formerPerson(id)) : null;
  return {
    id: a.id,
    kind: a.kind,
    status: a.status,
    locationId: a.officeId,
    locationName: a.officeId ? (officeNames.get(a.officeId) ?? null) : null,
    manager: person(a.managerUserId),
    newManager: person(a.newManagerUserId),
    effectiveAt: a.effectiveAt.toISOString(),
    originalEffectiveAt: (a.originalEffectiveAt ?? a.effectiveAt).toISOString(),
    createdBy: {
      userId: a.createdByUserId,
      name: persons.get(a.createdByUserId)?.user.name ?? 'Former member',
    },
    createdAt: a.createdAt.toISOString(),
    finishedAt: a.finishedAt?.toISOString() ?? null,
    failureCode: a.failureCode,
  };
}

/** Actions as the screen shows them, with the people and location names they name. */
export async function actionsOf(
  tx: TxClient,
  businessId: string,
  rows: ActionRow[],
): Promise<LocationAction[]> {
  if (!rows.length) return [];
  const officeIds = [...new Set(rows.map((r) => r.officeId).filter((id): id is string => !!id))];
  const [persons, offices] = await Promise.all([
    peopleOf(
      tx,
      businessId,
      rows.flatMap((r) => [r.managerUserId, r.newManagerUserId, r.createdByUserId]),
    ),
    officeIds.length
      ? tx.firmOffice.findMany({
          where: { businessId, id: { in: officeIds } },
          select: { id: true, name: true },
        })
      : Promise.resolve([]),
  ]);
  const names = new Map(offices.map((o) => [o.id, o.name]));
  return rows.map((r) => toAction(r, persons, names));
}

/** The table's rows: manager (or acting), staff count and pending change of each location. */
export async function rowsOf(
  tx: TxClient,
  businessId: string,
  offices: OfficeRow[],
): Promise<LocationRow[]> {
  if (!offices.length) return [];
  const ids = offices.map((o) => o.id);
  const [mainManager, pending, staff] = await Promise.all([
    mainManagerOf(tx, businessId),
    tx.firmOfficeAction.findMany({
      where: { businessId, status: 'PENDING', officeId: { in: ids } },
    }),
    tx.firmOfficeMember.groupBy({
      by: ['officeId'],
      where: { businessId, officeId: { in: ids }, member: { status: { not: 'DEACTIVATED' } } },
      _count: { _all: true },
    }),
  ]);
  const persons = await peopleOf(tx, businessId, [
    mainManager,
    ...offices.map((o) => o.managerUserId),
    ...pending.flatMap((a) => [a.managerUserId, a.newManagerUserId, a.createdByUserId]),
  ]);
  const names = new Map(offices.map((o) => [o.id, o.name]));
  const counts = new Map(staff.map((s) => [s.officeId, s._count._all]));
  const pendingOf = new Map(pending.map((a) => [a.officeId, a]));
  const main = refOf(persons, mainManager);
  return offices.map((o) => {
    const runner = runnerOf(refOf(persons, o.managerUserId), main);
    const action = pendingOf.get(o.id);
    const person = runner ? persons.get(runner.userId) : undefined;
    return {
      id: o.id,
      name: o.name,
      kind: o.kind,
      status: o.status,
      isMain: o.isMain,
      addressLine1: o.addressLine1,
      addressLine2: o.addressLine2,
      city: o.city,
      state: o.state,
      postalCode: o.postalCode,
      staffCount: counts.get(o.id) ?? 0,
      manager: runner ? (person ? toPerson(person) : formerPerson(runner.userId)) : null,
      managerIsActing: runner?.acting ?? false,
      pendingAction: action ? toAction(action, persons, names) : null,
    };
  });
}

/** The plan's allowance of locations (null: no subscription in force, so no limit). */
export async function allowedOf(tx: TxClient, businessId: string): Promise<number | null> {
  const sub = await tx.platformFirmSubscription.findUnique({
    where: { businessId },
    select: { locationsIncluded: true, locationsPurchased: true, status: true },
  });
  return allowanceOf(sub);
}

/** The ACTIVE live locations: what the plan's allowance counts. */
export const activeCount = (tx: TxClient, businessId: string) =>
  tx.firmOffice.count({ where: { businessId, archivedAt: null, status: 'ACTIVE' } });

export async function kpisIn(tx: TxClient, businessId: string): Promise<LocationsKpis> {
  const [total, active, allowed] = await Promise.all([
    tx.firmOffice.count({ where: { businessId, archivedAt: null } }),
    activeCount(tx, businessId),
    allowedOf(tx, businessId),
  ]);
  return kpisOf({ total, active }, allowed);
}

/** A live location of the firm, else 404. */
export async function liveOffice(tx: TxClient, businessId: string, id: string): Promise<OfficeRow> {
  const office = await tx.firmOffice.findFirst({ where: { businessId, id, archivedAt: null } });
  if (!office) throw notFound();
  return office;
}

/** The profile as read in a transaction; the photo's link is added outside it. */
export interface ProfileDraft {
  profile: Omit<LocationProfile, 'photoUrl'>;
  photoKey: string | null;
}

const PHOTO_TYPES: Record<string, string> = {
  jpg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
};
export const photoTypeOfKey = (key: string): string =>
  PHOTO_TYPES[key.slice(key.lastIndexOf('.') + 1)] ?? 'image/jpeg';

@Injectable()
export class LocationsReadService {
  private readonly logger = new Logger(LocationsReadService.name);

  constructor(
    @Inject(DATABASE) private readonly database: Database,
    @Inject(DOCUMENT_STORAGE) private readonly storage: DocumentStorage,
    private readonly grants: PermissionGrantsService,
  ) {}

  inFirm<T>(businessId: string, fn: (tx: TxClient) => Promise<T>): Promise<T> {
    return this.database.withScope({ kind: 'business', businessId }, fn);
  }

  /** Whether the viewer is a Super Administrator (Owner, or Admin with MANAGE on SETTINGS). */
  canManageSchedules(tenant: TenantContext, userId: string): Promise<boolean> {
    return isSuperAdministrator(this.grants, {
      businessId: tenant.businessId,
      userId,
      role: tenant.role,
      customRoleId: tenant.kind === 'staff' ? (tenant.customRoleId ?? null) : null,
    });
  }

  list(businessId: string, q: Out<typeof LocationsQ>): Promise<LocationList> {
    return this.inFirm(businessId, async (tx) => {
      const and: Prisma.FirmOfficeWhereInput[] = [];
      if (q.search) {
        const has = { contains: q.search, mode: 'insensitive' as const };
        and.push({
          OR: [{ name: has }, { city: has }, { manager: { is: { user: { name: has } } } }],
        });
      }
      if (q.managerUserId) {
        // The main location's manager also runs the locations they act for.
        const main = await mainManagerOf(tx, businessId);
        const acting =
          main === q.managerUserId
            ? [{ managerUserId: null }, { manager: { is: { status: 'DEACTIVATED' as const } } }]
            : [];
        and.push({ OR: [{ managerUserId: q.managerUserId }, ...acting] });
      }
      const where: Prisma.FirmOfficeWhereInput = {
        businessId,
        archivedAt: null,
        ...(q.status ? { status: q.status } : {}),
        ...(q.city ? { city: { equals: q.city, mode: 'insensitive' } } : {}),
        ...(and.length ? { AND: and } : {}),
      };
      const order = q.order;
      const orderBy: Prisma.FirmOfficeOrderByWithRelationInput[] =
        q.sort === 'city'
          ? [{ city: { sort: order, nulls: 'last' } }, { name: 'asc' }, { id: 'asc' }]
          : q.sort === 'status'
            ? [{ status: order }, { name: 'asc' }, { id: 'asc' }]
            : q.sort === 'createdAt'
              ? [{ createdAt: order }, { id: order }]
              : [{ name: order }, { id: order }];
      const [total, offices, kpis] = await Promise.all([
        tx.firmOffice.count({ where }),
        tx.firmOffice.findMany({
          where,
          orderBy,
          skip: (q.page - 1) * q.limit,
          take: q.limit,
        }),
        kpisIn(tx, businessId),
      ]);
      return { items: await rowsOf(tx, businessId, offices), total, kpis };
    });
  }

  async options(tenant: TenantContext, userId: string): Promise<LocationOptions> {
    const { businessId } = tenant;
    const canManageSchedules = await this.canManageSchedules(tenant, userId);
    return this.inFirm(businessId, async (tx) => {
      const [members, services, timeZone, business, settings, cities] = await Promise.all([
        tx.membership.findMany({
          where: { businessId, status: 'ACTIVE' },
          select: { userId: true, role: true, jobTitle: true, user: { select: { name: true } } },
          orderBy: [{ user: { name: 'asc' } }, { userId: 'asc' }],
          take: 1000,
        }),
        tx.service.findMany({
          where: { businessId, archivedAt: null, status: 'ACTIVE' },
          select: { id: true, name: true, kind: true },
          orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }, { id: 'asc' }],
          take: 500,
        }),
        firmTimeZone(tx, businessId),
        tx.business.findUnique({ where: { id: businessId }, select: { legalName: true } }),
        tx.businessSettings.findUnique({
          where: { businessId },
          select: { entityType: true, einLast4: true },
        }),
        tx.firmOffice.findMany({
          where: { businessId, archivedAt: null, city: { not: null } },
          select: { city: true },
          distinct: ['city'],
          orderBy: { city: 'asc' },
          take: 500,
        }),
      ]);
      const structure = settings?.entityType;
      return {
        members: members.map((m) => ({
          userId: m.userId,
          name: m.user.name,
          role: m.role,
          jobTitle: m.jobTitle,
        })),
        services,
        firmTimeZone: timeZone,
        company: {
          legalName: business?.legalName ?? null,
          businessStructure:
            structure && Object.hasOwn(ENTITY_TYPES, structure)
              ? ENTITY_TYPES[structure as keyof typeof ENTITY_TYPES]
              : null,
          einLast4: settings?.einLast4 ?? null,
        },
        cities: cities.map((c) => c.city).filter((c): c is string => c !== null),
        canManageSchedules,
      };
    });
  }

  /** The profile in the caller's transaction (no photo link yet: see `withPhoto`). */
  async profileIn(tx: TxClient, businessId: string, id: string): Promise<ProfileDraft> {
    const office = await liveOffice(tx, businessId, id);
    const [[row], hours, services, staff, futureAppointments, zone] = await Promise.all([
      rowsOf(tx, businessId, [office]),
      tx.firmOfficeHours.findMany({
        where: { businessId, officeId: id },
        orderBy: [{ weekday: 'asc' }, { opensAt: 'asc' }],
      }),
      tx.firmOfficeService.findMany({
        where: { businessId, officeId: id, service: { archivedAt: null, status: 'ACTIVE' } },
        select: { service: { select: { id: true, name: true, kind: true, sortOrder: true } } },
      }),
      tx.firmOfficeMember.findMany({
        where: { businessId, officeId: id, member: { status: { not: 'DEACTIVATED' } } },
        select: { member: { select: personSelect } },
      }),
      tx.appointment.count({
        where: { businessId, officeId: id, status: 'SCHEDULED', startsAt: { gt: new Date() } },
      }),
      firmTimeZone(tx, businessId),
    ]);
    return {
      profile: {
        ...(row as LocationRow),
        phone: office.phone,
        alternatePhone: office.alternatePhone,
        email: office.email,
        timeZone: office.timeZone,
        effectiveTimeZone: office.timeZone ?? zone,
        notes: office.notes,
        hours: hours.map((h) => ({
          weekday: h.weekday,
          opensAt: timeOfDayFromDb(h.opensAt),
          closesAt: timeOfDayFromDb(h.closesAt),
        })),
        services: services
          .map((s) => s.service)
          .sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name))
          .map((s) => ({ id: s.id, name: s.name, kind: s.kind })),
        staff: staff
          .map((s) => toPerson(s.member))
          .sort((a, b) => a.name.localeCompare(b.name) || a.userId.localeCompare(b.userId)),
        futureAppointments,
        createdAt: office.createdAt.toISOString(),
        updatedAt: office.updatedAt.toISOString(),
      },
      photoKey: office.photoKey,
    };
  }

  /** The profile with a short-lived link to its photo (outside any transaction). */
  async withPhoto(draft: ProfileDraft): Promise<LocationProfile> {
    let photoUrl: string | null = null;
    if (draft.photoKey) {
      const key = draft.photoKey;
      const type = photoTypeOfKey(key);
      photoUrl = await this.storage
        .presignDownload({
          key,
          fileName: `location-photo.${key.split('.').pop() ?? 'jpg'}`,
          contentType: type,
        })
        .catch((error: unknown) => {
          this.logger.warn(
            `Could not sign a location photo link (${error instanceof Error ? error.name : 'Error'}, HTTP ${statusOf(error)})`,
          );
          return null;
        });
    }
    return { ...draft.profile, photoUrl };
  }

  async get(businessId: string, id: string): Promise<LocationProfile> {
    return this.withPhoto(
      await this.inFirm(businessId, (tx) => this.profileIn(tx, businessId, id)),
    );
  }

  actions(businessId: string, q: Out<typeof LocationActionsQ>): Promise<LocationActionList> {
    return this.inFirm(businessId, async (tx) => {
      const rows = await tx.firmOfficeAction.findMany({
        where: {
          businessId,
          ...(q.status ? { status: q.status } : {}),
          ...(q.locationId ? { officeId: q.locationId } : {}),
        },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: q.limit,
      });
      return { items: await actionsOf(tx, businessId, rows) };
    });
  }

  activity(businessId: string, q: Out<typeof LocationActivityQ>): Promise<LocationActivity> {
    return this.inFirm(businessId, async (tx) => {
      if (q.locationId) {
        const office = await tx.firmOffice.findFirst({
          where: { businessId, id: q.locationId },
          select: { id: true },
        });
        if (!office) throw notFound();
      }
      const rows = await tx.auditLog.findMany({
        where: {
          businessId,
          ...(q.locationId
            ? {
                OR: [
                  { entityType: 'firm_office', entityId: q.locationId },
                  {
                    entityType: 'firm_office_action',
                    metadata: { path: ['officeId'], equals: q.locationId },
                  },
                ],
              }
            : { entityType: { in: ['firm_office', 'firm_office_action'] } }),
        },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: q.limit,
        select: {
          id: true,
          createdAt: true,
          action: true,
          entityType: true,
          entityId: true,
          metadata: true,
        },
      });
      const names = await officeNamesOf(tx, businessId, rows);
      return { items: rows.map((r) => activityItem(r, names)) };
    });
  }
}
