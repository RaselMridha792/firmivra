import {
  type AdminActivityItem,
  ApiRequestError,
  CreateLocationRequest,
  DeactivateLocationRequest,
  DeactivateManagerRequest,
  LOCATION_DUPLICATE_MESSAGE,
  type LocationAction,
  type LocationHoursInterval,
  type LocationList,
  type LocationOptions,
  type LocationPerson,
  type LocationProfile,
  type LocationRow,
  LocationActivityQuery,
  LocationsQuery,
  type LocationsClient,
  parseInput,
  ReassignManagerRequest,
  SetLocationStaffRequest,
  UpdateLocationActionRequest,
  UpdateLocationRequest,
} from '@firmivra/types';
import { mockDelay } from '../lib/mock';
import { mockClientServices } from './clients';
import { teamFixtures } from './team';

/**
 * Mock data for `api.locations` (R1's Settings > Locations contract): three offices of the mock
 * firm (Auburn, the primary; Lawrenceville; a virtual office, inactive), their hours, services and
 * staff from the team and Services & Pricing mocks, scheduled actions and the activity they write.
 * Synthetic data only. Owner and Admin only (STAFF: 403), as the API; the Owner is the Super
 * Administrator who deactivates and schedules. `empty: true` gives no locations.
 */

type MockRole = 'OWNER' | 'ADMIN' | 'STAFF';
interface Options {
  role?: MockRole;
  empty?: boolean;
}

interface Stored {
  id: string;
  name: string;
  kind: 'OFFICE' | 'VIRTUAL';
  status: 'ACTIVE' | 'INACTIVE';
  isMain: boolean;
  addressLine1: string | null;
  addressLine2: string | null;
  city: string | null;
  state: string | null;
  postalCode: string | null;
  phone: string | null;
  alternatePhone: string | null;
  email: string | null;
  timeZone: string | null;
  notes: string | null;
  photoUrl: string | null;
  hours: LocationHoursInterval[];
  serviceIds: string[];
  staffUserIds: string[];
  managerUserId: string | null;
  futureAppointments: number;
  createdAt: string;
  updatedAt: string;
}

const FIRM_ZONE = 'America/New_York';
const ALLOWED = 5;
const fail = (status: number, code: string, message: string) =>
  new ApiRequestError(status, code, message);
const id = (block: string, n: number) =>
  `0199c0${block}-0000-7000-8000-${String(n).padStart(12, '0')}`;
let seq = 100;
const daysAgo = (n: number, hour = 10) => {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - n);
  d.setUTCHours(hour, 0, 0, 0);
  return d.toISOString();
};
/** Monday to Friday, 9 to 5. */
const weekdays = (): LocationHoursInterval[] =>
  [1, 2, 3, 4, 5].map((weekday) => ({ weekday, opensAt: '09:00', closesAt: '17:00' }));

export function createLocationsMock(options: Options = {}): LocationsClient {
  const role = options.role ?? 'OWNER';
  const team = teamFixtures().filter((m) => m.status === 'ACTIVE');
  const [owner, admin, staff] = team;
  const services = mockClientServices();
  const people = new Map<string, LocationPerson>(
    team.map((m) => [
      m.user.id,
      {
        userId: m.user.id,
        name: m.user.name,
        jobTitle: { OWNER: 'Office Manager', ADMIN: 'Senior Tax Preparer', STAFF: 'Bookkeeper' }[
          m.role as 'OWNER' | 'ADMIN' | 'STAFF'
        ],
        email: m.user.email,
        phone: '+14045550101',
      },
    ]),
  );
  let rows: Stored[] = options.empty
    ? []
    : [
        {
          id: id('01', 1),
          name: 'Auburn Office',
          kind: 'OFFICE',
          status: 'ACTIVE',
          isMain: true,
          addressLine1: '123 Main St',
          addressLine2: null,
          city: 'Auburn',
          state: 'GA',
          postalCode: '30011',
          phone: '+15551234567',
          alternatePhone: null,
          email: 'auburn@example.test',
          timeZone: null,
          notes: 'Parking behind the building (sample).',
          photoUrl: null,
          hours: [
            ...weekdays().filter((h) => h.weekday !== 3),
            // Wednesday has two blocks (a lunch break).
            { weekday: 3, opensAt: '09:00', closesAt: '12:00' },
            { weekday: 3, opensAt: '13:00', closesAt: '17:00' },
          ],
          serviceIds: services.slice(0, 3).map((s) => s.id),
          staffUserIds: team.map((m) => m.user.id),
          managerUserId: owner?.user.id ?? null,
          futureAppointments: 4,
          createdAt: daysAgo(40),
          updatedAt: daysAgo(3),
        },
        {
          id: id('01', 2),
          name: 'Lawrenceville Office',
          kind: 'OFFICE',
          status: 'ACTIVE',
          isMain: false,
          addressLine1: '456 Pine Rd',
          addressLine2: 'Suite 200',
          city: 'Lawrenceville',
          state: 'GA',
          postalCode: '30046',
          phone: '+15559876543',
          alternatePhone: null,
          email: 'lawrenceville@example.test',
          timeZone: null,
          notes: null,
          photoUrl: null,
          hours: weekdays(),
          serviceIds: services.slice(1, 3).map((s) => s.id),
          staffUserIds: [admin?.user.id, staff?.user.id].filter((v): v is string => !!v),
          managerUserId: admin?.user.id ?? null,
          futureAppointments: 0,
          createdAt: daysAgo(20),
          updatedAt: daysAgo(5),
        },
        {
          id: id('01', 3),
          name: 'Virtual Office',
          kind: 'VIRTUAL',
          status: 'INACTIVE',
          isMain: false,
          addressLine1: null,
          addressLine2: null,
          city: null,
          state: null,
          postalCode: null,
          phone: '+15550001111',
          alternatePhone: null,
          email: 'virtual@example.test',
          timeZone: null,
          notes: null,
          photoUrl: null,
          hours: [],
          serviceIds: [],
          staffUserIds: staff ? [staff.user.id] : [],
          managerUserId: null,
          futureAppointments: 0,
          createdAt: daysAgo(10),
          updatedAt: daysAgo(8),
        },
      ];
  let actions: LocationAction[] = [];
  const activity: AdminActivityItem[] = options.empty
    ? []
    : [
        {
          id: id('02', 1),
          at: daysAgo(3, 14),
          action: 'location.updated',
          label: 'Location information updated: Auburn Office',
          tone: 'info',
        },
        {
          id: id('02', 2),
          at: daysAgo(5, 11),
          action: 'location.staff_set',
          label: 'Staff assigned: Lawrenceville Office',
          tone: 'user',
        },
        {
          id: id('02', 3),
          at: daysAgo(8, 9),
          action: 'location.deactivated',
          label: 'Location deactivated: Virtual Office',
          tone: 'warning',
        },
        {
          id: id('02', 4),
          at: daysAgo(40, 15),
          action: 'location.created',
          label: 'Location created: Auburn Office',
          tone: 'success',
        },
      ];

  const manage = () => {
    if (role === 'STAFF') throw fail(403, 'FORBIDDEN', 'You do not have access to this action');
  };
  const superAdmin = () => {
    if (role !== 'OWNER') {
      throw fail(403, 'FORBIDDEN', 'Only a Super Administrator can do this');
    }
  };
  const log = (action: string, label: string, tone: AdminActivityItem['tone']) =>
    activity.unshift({ id: id('02', ++seq), at: new Date().toISOString(), action, label, tone });
  const find = (locationId: string) => {
    const row = rows.find((r) => r.id === locationId);
    if (!row) throw fail(404, 'NOT_FOUND', 'Not found');
    return row;
  };
  const main = () => rows.find((r) => r.isMain);
  const pendingOf = (r: Stored) =>
    actions.find((a) => a.status === 'PENDING' && a.locationId === r.id) ?? null;
  const toRow = (r: Stored): LocationRow => {
    const own = r.managerUserId ? (people.get(r.managerUserId) ?? null) : null;
    const acting = !own && main()?.managerUserId ? people.get(main()!.managerUserId!) : null;
    return {
      id: r.id,
      name: r.name,
      kind: r.kind,
      status: r.status,
      isMain: r.isMain,
      addressLine1: r.addressLine1,
      addressLine2: r.addressLine2,
      city: r.city,
      state: r.state,
      postalCode: r.postalCode,
      staffCount: r.staffUserIds.length,
      manager: own ?? acting ?? null,
      managerIsActing: !own && !!acting,
      pendingAction: pendingOf(r),
    };
  };
  const toProfile = (r: Stored): LocationProfile => ({
    ...toRow(r),
    phone: r.phone,
    alternatePhone: r.alternatePhone,
    email: r.email,
    timeZone: r.timeZone,
    effectiveTimeZone: r.timeZone ?? FIRM_ZONE,
    notes: r.notes,
    photoUrl: r.photoUrl,
    hours: [...r.hours].sort((a, b) => a.weekday - b.weekday || a.opensAt.localeCompare(b.opensAt)),
    services: services.filter((s) => r.serviceIds.includes(s.id)),
    staff: r.staffUserIds.map((u) => people.get(u)).filter((p): p is LocationPerson => !!p),
    futureAppointments: r.futureAppointments,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
  });
  const kpis = () => ({
    total: rows.length,
    active: rows.filter((r) => r.status === 'ACTIVE').length,
    subscription: { used: rows.filter((r) => r.status === 'ACTIVE').length, allowed: ALLOWED },
  });
  /** The same address, or the same name, as another location (decision 5). */
  const duplicate = (
    body: { name: string; addressLine1?: string | null; postalCode?: string | null },
    except?: string,
  ) => {
    const norm = (v: string | null | undefined) => (v ?? '').trim().toLowerCase();
    return rows.some(
      (r) =>
        r.id !== except &&
        (norm(r.name) === norm(body.name) ||
          (!!body.addressLine1 &&
            norm(r.addressLine1) === norm(body.addressLine1) &&
            norm(r.postalCode) === norm(body.postalCode))),
    );
  };
  const member = (userId: string) => {
    if (!people.has(userId)) {
      throw fail(400, 'MANAGER_NOT_ELIGIBLE', 'Choose an active member of your firm');
    }
  };
  const action = (
    kind: LocationAction['kind'],
    r: Stored | null,
    when: string,
    manager: string | null,
    newManager: string | null,
  ): LocationAction => ({
    id: id('03', ++seq),
    kind,
    status: 'PENDING',
    locationId: r?.id ?? null,
    locationName: r?.name ?? null,
    manager: manager ? (people.get(manager) ?? null) : null,
    newManager: newManager ? (people.get(newManager) ?? null) : null,
    effectiveAt: when,
    originalEffectiveAt: when,
    createdBy: { userId: owner?.user.id ?? id('04', 1), name: owner?.user.name ?? 'Owner' },
    createdAt: new Date().toISOString(),
    finishedAt: null,
    failureCode: null,
  });
  const future = (when: string | undefined) => {
    if (when && Date.parse(when) <= Date.now()) {
      throw fail(400, 'VALIDATION_FAILED', 'Choose a time in the future');
    }
  };

  return {
    list: async (query = {}) => {
      await mockDelay();
      manage();
      const q = parseInput(LocationsQuery, query);
      const term = q.search?.toLowerCase();
      const matches = rows
        .filter((r) => !q.status || r.status === q.status)
        .filter((r) => !q.city || r.city === q.city)
        .filter((r) => !q.managerUserId || toRow(r).manager?.userId === q.managerUserId)
        .filter(
          (r) =>
            !term ||
            [r.name, r.city, toRow(r).manager?.name].some((v) => v?.toLowerCase().includes(term)),
        )
        .sort((a, b) => {
          const key = (r: Stored) =>
            q.sort === 'city' ? (r.city ?? '') : q.sort === 'status' ? r.status : r.name;
          return (q.order === 'desc' ? -1 : 1) * key(a).localeCompare(key(b));
        });
      const start = (q.page - 1) * q.limit;
      const list: LocationList = {
        items: matches.slice(start, start + q.limit).map(toRow),
        total: matches.length,
        kpis: kpis(),
      };
      return list;
    },
    options: async () => {
      await mockDelay();
      manage();
      const o: LocationOptions = {
        members: team.map((m) => ({
          userId: m.user.id,
          name: m.user.name,
          role: m.role,
          jobTitle: people.get(m.user.id)?.jobTitle ?? null,
        })),
        services,
        firmTimeZone: FIRM_ZONE,
        company: {
          legalName: 'LVP Accounting & Taxes (sample)',
          businessStructure: 'LLC',
          einLast4: '4321',
        },
        cities: [...new Set(rows.map((r) => r.city).filter((c): c is string => !!c))].sort(),
        canManageSchedules: role === 'OWNER',
      };
      return o;
    },
    get: async (locationId) => {
      await mockDelay();
      manage();
      return toProfile(find(locationId));
    },
    create: async (body) => {
      await mockDelay();
      manage();
      const b = parseInput(CreateLocationRequest, body);
      member(b.managerUserId);
      if (duplicate(b)) throw fail(409, 'DUPLICATE_LOCATION', LOCATION_DUPLICATE_MESSAGE);
      if (b.status === 'ACTIVE' && kpis().subscription.used >= ALLOWED) {
        throw fail(409, 'LOCATION_LIMIT', "Your plan's locations are all in use");
      }
      const now = new Date().toISOString();
      if (b.isMain) rows = rows.map((r) => ({ ...r, isMain: false }));
      const row: Stored = {
        id: id('01', ++seq),
        name: b.name,
        kind: b.kind,
        status: b.status,
        isMain: b.isMain,
        addressLine1: b.addressLine1 ?? null,
        addressLine2: b.addressLine2 ?? null,
        city: b.city ?? null,
        state: b.state ?? null,
        postalCode: b.postalCode ?? null,
        phone: b.phone,
        alternatePhone: b.alternatePhone ?? null,
        email: b.email,
        timeZone: b.timeZone ?? null,
        notes: b.notes ?? null,
        photoUrl: null,
        hours: b.hours,
        serviceIds: b.serviceIds,
        staffUserIds: b.staffUserIds,
        managerUserId: b.managerUserId,
        futureAppointments: 0,
        createdAt: now,
        updatedAt: now,
      };
      rows = [...rows, row];
      log('location.created', `Location created: ${row.name}`, 'success');
      return toProfile(row);
    },
    update: async (locationId, body) => {
      await mockDelay();
      manage();
      const b = parseInput(UpdateLocationRequest, body);
      const r = find(locationId);
      if (b.expectedUpdatedAt !== r.updatedAt) {
        throw fail(409, 'SAVE_CONFLICT', 'Someone else saved this location. Reload to see it.');
      }
      if (duplicate(b, r.id)) throw fail(409, 'DUPLICATE_LOCATION', LOCATION_DUPLICATE_MESSAGE);
      Object.assign(r, {
        name: b.name,
        kind: b.kind,
        addressLine1: b.addressLine1 ?? null,
        addressLine2: b.addressLine2 ?? null,
        city: b.city ?? null,
        state: b.state ?? null,
        postalCode: b.postalCode ?? null,
        phone: b.phone,
        alternatePhone: b.alternatePhone ?? null,
        email: b.email,
        timeZone: b.timeZone ?? null,
        notes: b.notes ?? null,
        hours: b.hours,
        serviceIds: b.serviceIds,
        staffUserIds: b.staffUserIds,
        updatedAt: new Date().toISOString(),
      });
      log('location.updated', `Location information updated: ${r.name}`, 'info');
      return toProfile(r);
    },
    setPrimary: async (locationId) => {
      await mockDelay();
      manage();
      const r = find(locationId);
      if (r.status !== 'ACTIVE') throw fail(409, 'CONFLICT', 'Only an active location is primary');
      rows = rows.map((x) => ({ ...x, isMain: x.id === r.id }));
      log('location.primary_set', `Primary location set: ${r.name}`, 'info');
      return toProfile(find(locationId));
    },
    activate: async (locationId) => {
      await mockDelay();
      manage();
      const r = find(locationId);
      if (kpis().subscription.used >= ALLOWED) {
        throw fail(409, 'LOCATION_LIMIT', "Your plan's locations are all in use");
      }
      r.status = 'ACTIVE';
      r.updatedAt = new Date().toISOString();
      log('location.activated', `Location activated: ${r.name}`, 'success');
      return toProfile(r);
    },
    deactivate: async (locationId, body = {}) => {
      await mockDelay();
      superAdmin();
      const b = parseInput(DeactivateLocationRequest, body);
      const r = find(locationId);
      if (r.isMain) {
        throw fail(409, 'LOCATION_IS_PRIMARY', 'Set another location as primary first');
      }
      if (pendingOf(r)) throw fail(409, 'PENDING_ACTION_EXISTS', 'A change is already scheduled');
      future(b.effectiveAt);
      if (b.effectiveAt) {
        actions = [action('DEACTIVATE_LOCATION', r, b.effectiveAt, null, null), ...actions];
        log('location.action_scheduled', `Deactivation scheduled: ${r.name}`, 'warning');
      } else {
        r.status = 'INACTIVE';
        r.updatedAt = new Date().toISOString();
        log('location.deactivated', `Location deactivated: ${r.name}`, 'warning');
      }
      return toProfile(r);
    },
    reassignManager: async (locationId, body) => {
      await mockDelay();
      manage();
      const b = parseInput(ReassignManagerRequest, body);
      const r = find(locationId);
      member(b.managerUserId);
      future(b.effectiveAt);
      if (b.effectiveAt) {
        if (pendingOf(r)) {
          throw fail(409, 'PENDING_ACTION_EXISTS', 'A change is already scheduled');
        }
        actions = [
          action('REASSIGN_MANAGER', r, b.effectiveAt, r.managerUserId, b.managerUserId),
          ...actions,
        ];
        log('location.action_scheduled', `Manager change scheduled: ${r.name}`, 'info');
      } else {
        r.managerUserId = b.managerUserId;
        r.updatedAt = new Date().toISOString();
        log(
          'location.manager_set',
          `Manager updated: ${people.get(b.managerUserId)?.name ?? 'A member'} manages ${r.name}`,
          'user',
        );
      }
      return toProfile(r);
    },
    setStaff: async (locationId, body) => {
      await mockDelay();
      manage();
      const b = parseInput(SetLocationStaffRequest, body);
      const r = find(locationId);
      b.staffUserIds.forEach(member);
      r.staffUserIds = b.staffUserIds;
      r.updatedAt = new Date().toISOString();
      log('location.staff_set', `Staff assigned: ${r.name}`, 'user');
      return toProfile(r);
    },
    deactivateManager: async (userId, body) => {
      await mockDelay();
      superAdmin();
      const b = parseInput(DeactivateManagerRequest, body);
      member(userId);
      future(b.effectiveAt);
      const recorded = action(
        'DEACTIVATE_MANAGER',
        null,
        b.effectiveAt ?? new Date().toISOString(),
        userId,
        b.replacementUserId,
      );
      if (!b.effectiveAt) {
        rows.forEach((r) => {
          if (r.managerUserId === userId) r.managerUserId = b.replacementUserId;
        });
        recorded.status = 'DONE';
        recorded.finishedAt = new Date().toISOString();
      }
      actions = [recorded, ...actions];
      log('location.manager_deactivated', 'Manager deactivation recorded', 'warning');
      return recorded;
    },
    actions: async () => {
      await mockDelay();
      manage();
      return { items: actions };
    },
    updateAction: async (actionId, body) => {
      await mockDelay();
      superAdmin();
      const b = parseInput(UpdateLocationActionRequest, body);
      const a = actions.find((x) => x.id === actionId);
      if (!a) throw fail(404, 'NOT_FOUND', 'Not found');
      if (a.status !== 'PENDING') throw fail(409, 'ACTION_FINISHED', 'This change is finished');
      future(b.effectiveAt);
      if (b.effectiveAt) a.effectiveAt = b.effectiveAt;
      if (b.newManagerUserId !== undefined) {
        a.newManager = b.newManagerUserId ? (people.get(b.newManagerUserId) ?? null) : null;
      }
      log('location.action_updated', 'Scheduled change edited', 'info');
      return a;
    },
    cancelAction: async (actionId) => {
      await mockDelay();
      superAdmin();
      const a = actions.find((x) => x.id === actionId);
      if (!a) throw fail(404, 'NOT_FOUND', 'Not found');
      if (a.status !== 'PENDING') throw fail(409, 'ACTION_FINISHED', 'This change is finished');
      a.status = 'CANCELLED';
      a.finishedAt = new Date().toISOString();
      log('location.action_cancelled', 'Scheduled change cancelled', 'info');
      return a;
    },
    activity: async (query = {}) => {
      await mockDelay();
      manage();
      const q = parseInput(LocationActivityQuery, query);
      return { items: activity.slice(0, q.limit) };
    },
    createPhotoUpload: async () => {
      await mockDelay();
      throw fail(503, 'FILE_STORE_UNAVAILABLE', 'Photos are not stored in mock mode.');
    },
    confirmPhotoUpload: async (locationId) => {
      await mockDelay();
      return toProfile(find(locationId));
    },
    removePhoto: async (locationId) => {
      await mockDelay();
      const r = find(locationId);
      r.photoUrl = null;
      return toProfile(r);
    },
  };
}
