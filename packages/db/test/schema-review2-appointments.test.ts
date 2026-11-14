// Octavia's Review 2 for Appointments, P1 rows 1 and 2 (R56, Rasel's approval Nov 14; migrations
// r56_location_other_video and r56_appointments_other_video_window): an Other Video Meeting with
// its platform, up to four meeting methods on a type, and a booking window in hours. Runs as the
// app role under RLS.
import { randomUUID } from 'node:crypto';
import { beforeAll, describe, expect, inject, it } from 'vitest';
import { connect, createTwoFirms, failure, type TwoFirms } from './r38-helpers.js';

const { owner, db } = connect(inject('dbUrls'));
let f: TwoFirms;
const A = () => db.forBusiness(f.firmA);

let nextSlot = 9000;
const slot = () => {
  const startsAt = new Date(Date.UTC(2033, 0, 1) + nextSlot++ * 3_600_000 * 2);
  return { startsAt, endsAt: new Date(startsAt.getTime() + 3_600_000) };
};
const type = (data: Record<string, unknown> = {}) =>
  A().appointmentType.create({
    data: {
      businessId: f.firmA,
      name: `Fake type ${randomUUID().slice(0, 8)}`,
      durationMinutes: 30,
      ...data,
    },
  });
const book = (data: Record<string, unknown> = {}) =>
  A().appointment.create({
    data: {
      businessId: f.firmA,
      staffUserId: f.memberA,
      clientId: f.clientA,
      locationKind: 'VIDEO',
      ...slot(),
      ...data,
    },
  });

beforeAll(async () => {
  f = await createTwoFirms(owner, 'r56appt2');
});

describe('Other Video Meeting (P1 row 1)', () => {
  it('a type offering it names the platform, and only then', async () => {
    const t = await type({
      meetingMethods: ['OTHER_VIDEO', 'PHONE'],
      otherVideoPlatform: 'Microsoft Teams',
    });
    expect(t).toMatchObject({ locationKind: 'OTHER_VIDEO', otherVideoPlatform: 'Microsoft Teams' });
    for (const bad of [
      { meetingMethods: ['OTHER_VIDEO'] },
      { meetingMethods: ['OTHER_VIDEO'], otherVideoPlatform: '   ' },
      { meetingMethods: ['OTHER_VIDEO'], otherVideoPlatform: 'x'.repeat(61) },
      { meetingMethods: ['VIDEO'], otherVideoPlatform: 'Google Meet' },
    ]) {
      expect(await failure(type(bad))).toMatch(/appointment_types_other_video_platform/);
    }
    // Dropping the method drops the platform with it, or the change is refused.
    expect(
      await failure(
        A().appointmentType.update({ where: { id: t.id }, data: { meetingMethods: ['PHONE'] } }),
      ),
    ).toMatch(/appointment_types_other_video_platform/);
    const changed = await A().appointmentType.update({
      where: { id: t.id },
      data: { meetingMethods: ['PHONE'], otherVideoPlatform: null },
    });
    expect(changed).toMatchObject({ locationKind: 'PHONE', otherVideoPlatform: null });
  });

  it('a type offers all four methods, but no more and no repeats', async () => {
    const t = await type({
      meetingMethods: ['IN_PERSON', 'PHONE', 'VIDEO', 'OTHER_VIDEO'],
      otherVideoPlatform: 'Google Meet',
    });
    expect(t.meetingMethods).toHaveLength(4);
    expect(
      await failure(type({ meetingMethods: ['PHONE', 'PHONE'], otherVideoPlatform: null })),
    ).toMatch(/appointment_types_meeting_methods/);
  });

  it('an appointment held on it names the platform, and only then', async () => {
    const a = await book({ locationKind: 'OTHER_VIDEO', otherVideoPlatform: 'Webex' });
    expect(a).toMatchObject({ locationKind: 'OTHER_VIDEO', otherVideoPlatform: 'Webex' });
    expect(await failure(book({ locationKind: 'OTHER_VIDEO' }))).toMatch(
      /appointments_other_video_platform/,
    );
    expect(await failure(book({ otherVideoPlatform: 'Webex' }))).toMatch(
      /appointments_other_video_platform/,
    );
    expect(await book()).toMatchObject({ locationKind: 'VIDEO', otherVideoPlatform: null });
  });
});

describe('booking window in hours (P1 row 2)', () => {
  it('takes 2 to 17,520 hours, or none', async () => {
    for (const hours of [2, 6, 12, 17_520]) {
      expect((await type({ maxWindowHours: hours })).maxWindowHours).toBe(hours);
    }
    expect((await type()).maxWindowHours).toBeNull();
    for (const hours of [0, 1, 17_521, -6]) {
      expect(await failure(type({ maxWindowHours: hours }))).toMatch(
        /appointment_types_max_window_hours/,
      );
    }
  });
});
