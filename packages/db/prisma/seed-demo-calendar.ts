// Demo seed, stage 2 (R0, PART 2): the calendar -- working hours for the client-facing staff
// (Mon-Fri 9-12 and 1-5, New York time), an office closure, and appointments over the last two
// weeks and the next two (completed, no-show, cancelled, scheduled, confirmed), so Calendar, Today,
// List, a client's Appointments tab and the portal Appointments page all have rows.
import { runInScope, type createPrismaClient } from '../src/client.js';
import { demoId, SEED_DEMO_USERS, type DemoStaffKey } from './seed-demo-data.js';
import { demoDay, demoEngagementId, type DemoEngagementSlot } from './seed-demo-engagements.js';
import type { DemoOrgResult } from './seed-demo-org.js';

type Prisma = ReturnType<typeof createPrismaClient>;

const HOURS_STAFF: readonly DemoStaffKey[] = [
  'owner',
  'manager',
  'taxPreparer',
  'bookkeeper',
  'clientSupport',
];

type TypeName = 'Tax consultation' | 'Document drop-off' | 'Bookkeeping review';
const TYPE_MINUTES: Record<TypeName, number> = {
  'Tax consultation': 30,
  'Document drop-off': 15,
  'Bookkeeping review': 60,
};
const TYPE_LOCATION: Record<TypeName, 'VIDEO' | 'IN_PERSON' | 'PHONE'> = {
  'Tax consultation': 'VIDEO',
  'Document drop-off': 'IN_PERSON',
  'Bookkeeping review': 'VIDEO',
};

interface DemoAppointment {
  key: string;
  clientKey: string;
  slot: DemoEngagementSlot;
  staff: DemoStaffKey;
  type: TypeName;
  /** Days from today, and the New York start time (UTC-4 in October). */
  day: number;
  at: string;
  status: 'SCHEDULED' | 'COMPLETED' | 'NO_SHOW' | 'CANCELLED';
  confirmed?: boolean;
  byClient?: boolean;
  phone?: boolean;
}

const APPOINTMENTS: readonly DemoAppointment[] = [
  {
    key: 'a01',
    clientKey: '01',
    slot: 'tax2025',
    staff: 'manager',
    type: 'Tax consultation',
    day: -12,
    at: '10:00',
    status: 'COMPLETED',
    byClient: true,
  },
  {
    key: 'a02',
    clientKey: '02',
    slot: 'tax2025',
    staff: 'taxPreparer',
    type: 'Document drop-off',
    day: -11,
    at: '14:00',
    status: 'COMPLETED',
  },
  {
    key: 'a03',
    clientKey: '04',
    slot: 'books',
    staff: 'bookkeeper',
    type: 'Bookkeeping review',
    day: -9,
    at: '11:00',
    status: 'COMPLETED',
  },
  {
    key: 'a04',
    clientKey: '05',
    slot: 'tax2025',
    staff: 'manager',
    type: 'Tax consultation',
    day: -8,
    at: '15:30',
    status: 'NO_SHOW',
  },
  {
    key: 'a05',
    clientKey: '08',
    slot: 'tax2025',
    staff: 'clientSupport',
    type: 'Tax consultation',
    day: -6,
    at: '09:30',
    status: 'CANCELLED',
    phone: true,
  },
  {
    key: 'a06',
    clientKey: '10',
    slot: 'books',
    staff: 'bookkeeper',
    type: 'Bookkeeping review',
    day: -5,
    at: '13:00',
    status: 'COMPLETED',
  },
  {
    key: 'a07',
    clientKey: '12',
    slot: 'tax2025',
    staff: 'taxPreparer',
    type: 'Tax consultation',
    day: -2,
    at: '16:00',
    status: 'COMPLETED',
  },
  {
    key: 'a08',
    clientKey: '01',
    slot: 'planning',
    staff: 'manager',
    type: 'Tax consultation',
    day: 0,
    at: '10:30',
    status: 'SCHEDULED',
    confirmed: true,
    byClient: true,
  },
  {
    key: 'a09',
    clientKey: '13',
    slot: 'books',
    staff: 'bookkeeper',
    type: 'Bookkeeping review',
    day: 0,
    at: '14:00',
    status: 'SCHEDULED',
    confirmed: true,
  },
  {
    key: 'a10',
    clientKey: '15',
    slot: 'tax2025',
    staff: 'taxPreparer',
    type: 'Document drop-off',
    day: 0,
    at: '16:15',
    status: 'SCHEDULED',
  },
  {
    key: 'a11',
    clientKey: '17',
    slot: 'tax2025',
    staff: 'manager',
    type: 'Tax consultation',
    day: 1,
    at: '09:00',
    status: 'SCHEDULED',
    confirmed: true,
  },
  {
    key: 'a12',
    clientKey: '19',
    slot: 'books',
    staff: 'bookkeeper',
    type: 'Bookkeeping review',
    day: 2,
    at: '11:00',
    status: 'SCHEDULED',
  },
  {
    key: 'a13',
    clientKey: '20',
    slot: 'tax2025',
    staff: 'taxPreparer',
    type: 'Tax consultation',
    day: 3,
    at: '13:30',
    status: 'SCHEDULED',
  },
  {
    key: 'a14',
    clientKey: '14',
    slot: 'tax2025',
    staff: 'clientSupport',
    type: 'Tax consultation',
    day: 4,
    at: '10:00',
    status: 'SCHEDULED',
    phone: true,
  },
  {
    key: 'a15',
    clientKey: '25',
    slot: 'books',
    staff: 'bookkeeper',
    type: 'Bookkeeping review',
    day: 6,
    at: '15:00',
    status: 'SCHEDULED',
  },
  {
    key: 'a16',
    clientKey: '21',
    slot: 'tax2025',
    staff: 'owner',
    type: 'Tax consultation',
    day: 7,
    at: '11:30',
    status: 'SCHEDULED',
    confirmed: true,
  },
  {
    key: 'a17',
    clientKey: '09',
    slot: 'tax2025',
    staff: 'taxPreparer',
    type: 'Document drop-off',
    day: 9,
    at: '09:45',
    status: 'SCHEDULED',
  },
  {
    key: 'a18',
    clientKey: '01',
    slot: 'tax2025',
    staff: 'manager',
    type: 'Tax consultation',
    day: 13,
    at: '14:30',
    status: 'SCHEDULED',
    byClient: true,
  },
];

/** New York local time on a demo day, as a UTC instant (October: UTC-4). */
const nyAt = (day: number, hhmm: string): Date => {
  const [h, m] = hhmm.split(':').map(Number) as [number, number];
  const d = demoDay(day);
  d.setUTCHours(h + 4, m, 0, 0);
  return d;
};

export async function seedDemoCalendar(prisma: Prisma, org: DemoOrgResult): Promise<void> {
  const { businessId } = org;
  const user = (key: DemoStaffKey) => SEED_DEMO_USERS[key].id;

  await runInScope(prisma, { kind: 'business', businessId }, async (tx) => {
    const at = (hhmm: string) => new Date(`1970-01-01T${hhmm}:00Z`);
    for (const key of HOURS_STAFF) {
      const staffHours = { businessId, userId: user(key) };
      if ((await tx.workingHours.count({ where: staffHours })) > 0) continue;
      await tx.workingHours.createMany({
        data: [1, 2, 3, 4, 5].flatMap((weekday) => [
          { ...staffHours, weekday, startsAt: at('09:00'), endsAt: at('12:00') },
          { ...staffHours, weekday, startsAt: at('13:00'), endsAt: at('17:00') },
        ]),
      });
    }

    const closureId = demoId('blocked-time:staff-training');
    await tx.blockedTime.upsert({
      where: { id: closureId },
      update: {},
      create: {
        id: closureId,
        businessId,
        startsAt: nyAt(10, '13:00'),
        endsAt: nyAt(10, '17:00'),
        reason: 'Staff training (office closed in the afternoon)',
        createdByUserId: user('owner'),
      },
    });

    for (const a of APPOINTMENTS) {
      const id = demoId(`appointment:${a.key}`);
      const startsAt = nyAt(a.day, a.at);
      const endsAt = new Date(startsAt.getTime() + TYPE_MINUTES[a.type] * 60_000);
      const locationKind = a.phone ? 'PHONE' : TYPE_LOCATION[a.type];
      await tx.appointment.upsert({
        where: { id },
        update: {},
        create: {
          id,
          businessId,
          clientId: org.clients[a.clientKey]!,
          engagementId: demoEngagementId(a.clientKey, a.slot),
          staffUserId: user(a.staff),
          typeId: org.appointmentTypeIds(a.type),
          startsAt,
          endsAt,
          locationKind,
          locationDetails:
            locationKind === 'VIDEO'
              ? `https://meet.demo.test/${a.staff.toLowerCase()}`
              : locationKind === 'PHONE'
                ? 'We will call the number on file.'
                : 'Main Office, 100 Market Street, Atlanta',
          status: a.status,
          bookedByClient: a.byClient ?? false,
          // Only the portal client has a login, so only its appointments are client-booked.
          bookedByUserId: a.byClient ? demoId(`user:client:${a.clientKey}`) : user(a.staff),
          timeZone: 'America/New_York',
          ...(a.confirmed ? { confirmedAt: demoDay(a.day - 2) } : {}),
          ...(a.status === 'CANCELLED'
            ? { cancelledAt: demoDay(a.day - 1), cancelReason: 'Client asked to reschedule.' }
            : {}),
        },
      });
    }
  });
}
