import { describe, expect, it } from 'vitest';
import {
  ApiRequestError,
  BookAppointmentRequest,
  CancelAppointmentRequest,
  CreateAppointmentTypeRequest,
  createAppointmentsClient,
  createAppointmentTypesClient,
  createAvailabilityClient,
  createMyAppointmentsClient,
  createRequest,
  SetWorkingHoursRequest,
  SlotsQuery,
} from '../../src/index.js';

function fakeFetch(status: number, body: unknown) {
  const calls: { url: string; method: string; body: unknown }[] = [];
  const fn = (async (url: string, init: RequestInit) => {
    calls.push({
      url,
      method: init.method ?? 'GET',
      body: init.body === undefined ? undefined : JSON.parse(init.body as string),
    });
    return new Response(JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json' },
    });
  }) as unknown as typeof fetch;
  return { fn, calls };
}

const id = '0199b6a0-0000-7000-8000-000000000001';
const at = '2026-10-13T14:00:00.000Z';
const member = { userId: '0199b6a0-0000-7000-8000-0000000000f1', name: 'Sam Staff' };
const appointment = {
  id,
  client: { id: '0199b6a1-0000-7000-8000-000000000001', displayName: 'Jamie Sample' },
  staff: member,
  type: { id: '0199b6a2-0000-7000-8000-000000000001', name: 'Tax consultation' },
  engagementId: null,
  startsAt: at,
  endsAt: '2026-10-13T14:30:00.000Z',
  status: 'SCHEDULED',
  locationKind: 'VIDEO',
  locationDetails: null,
  bookedByClient: false,
  rescheduleCount: 0,
  cancelledAt: null,
  cancelReason: null,
  createdAt: at,
};

describe('appointment schemas', () => {
  it('keeps durations and times of day on a 15-minute grid', () => {
    const type = { name: 'Consult', durationMinutes: 30 };
    expect(CreateAppointmentTypeRequest.parse(type)).toMatchObject({
      locationKind: 'VIDEO',
      clientBookable: false,
      cancelCutoffHours: 24,
    });
    expect(CreateAppointmentTypeRequest.safeParse({ ...type, durationMinutes: 20 }).success).toBe(
      false,
    );
    const hours = (startsAt: string, endsAt: string) => ({
      hours: [{ weekday: 1, startsAt, endsAt }],
    });
    expect(SetWorkingHoursRequest.safeParse(hours('09:00', '17:00')).success).toBe(true);
    expect(SetWorkingHoursRequest.safeParse(hours('09:10', '17:00')).success).toBe(false);
    expect(SetWorkingHoursRequest.safeParse(hours('17:00', '09:00')).success).toBe(false);
  });

  it('refuses overlapping ranges on one day, but not on different days', () => {
    const range = (weekday: number, startsAt: string, endsAt: string) => ({
      weekday,
      startsAt,
      endsAt,
    });
    const lunch = [range(1, '09:00', '12:00'), range(1, '13:00', '17:00')];
    expect(SetWorkingHoursRequest.safeParse({ hours: lunch }).success).toBe(true);
    const overlap = [range(1, '09:00', '12:00'), range(1, '11:00', '17:00')];
    expect(SetWorkingHoursRequest.safeParse({ hours: overlap }).success).toBe(false);
    const twoDays = [range(1, '09:00', '12:00'), range(2, '11:00', '17:00')];
    expect(SetWorkingHoursRequest.safeParse({ hours: twoDays }).success).toBe(true);
  });

  it('needs a type or a duration to book, and limits slot ranges to 31 days', () => {
    const base = { clientId: id, staffUserId: member.userId, startsAt: at };
    expect(BookAppointmentRequest.safeParse(base).success).toBe(false);
    expect(BookAppointmentRequest.safeParse({ ...base, durationMinutes: 45 }).success).toBe(true);
    const slots = { typeId: id, from: '2026-10-13', to: '2026-11-13' };
    expect(SlotsQuery.safeParse(slots).success).toBe(true);
    expect(SlotsQuery.safeParse({ ...slots, to: '2026-11-14' }).success).toBe(false);
  });
});

describe('appointment schemas (#68 review)', () => {
  it("reads '' as no reason, and lets a reschedule exclude the moved appointment", () => {
    expect(CancelAppointmentRequest.parse({ reason: '' })).toEqual({ reason: null });
    const query = { typeId: id, from: '2026-10-13', to: '2026-10-20', excludeAppointmentId: id };
    expect(SlotsQuery.parse(query)).toMatchObject({ excludeAppointmentId: id });
  });
});

describe('appointment clients', () => {
  it('calls the firm routes with the checked bodies', async () => {
    const types = fakeFetch(200, { items: [] });
    await createAppointmentTypesClient(createRequest({ baseUrl: '', fetch: types.fn })).list();
    expect(types.calls[0]?.url).toBe('/business/appointment-types?status=active');

    const availability = fakeFetch(200, { member, hours: [] });
    await createAvailabilityClient(
      createRequest({ baseUrl: '', fetch: availability.fn }),
    ).setWorkingHours(member.userId, { hours: [] });
    expect(availability.calls[0]).toEqual({
      url: `/business/availability/${member.userId}/working-hours`,
      method: 'PUT',
      body: { hours: [] },
    });

    const booked = fakeFetch(200, appointment);
    const appointments = createAppointmentsClient(createRequest({ baseUrl: '', fetch: booked.fn }));
    await appointments.reschedule(id, { startsAt: at });
    expect(booked.calls[0]).toEqual({
      url: `/business/appointments/${id}/reschedule`,
      method: 'POST',
      body: { startsAt: at },
    });
    await appointments.noShow(id);
    expect(booked.calls[1]).toMatchObject({ url: `/business/appointments/${id}/no-show` });
  });

  it("calls the client's own routes, and rejects bad input before sending", async () => {
    const slots = fakeFetch(200, { timezone: 'America/New_York', slots: [] });
    const mine = createMyAppointmentsClient(createRequest({ baseUrl: '', fetch: slots.fn }), 'lvp');
    await mine.slots({ typeId: id, from: '2026-10-13', to: '2026-10-20' });
    expect(slots.calls[0]?.url).toBe(
      `/portal/lvp/me/appointments/slots?typeId=${id}&from=2026-10-13&to=2026-10-20`,
    );
    const err = await mine.reschedule('not-an-id', { startsAt: at }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiRequestError);
    expect(err).toMatchObject({ status: 400, code: 'VALIDATION_FAILED' });
    expect(slots.calls).toHaveLength(1);
  });
});
