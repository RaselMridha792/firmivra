import { describe, expect, it } from 'vitest';
import {
  AgendaPage,
  createRequest,
  createSchedulingClient,
  ScheduleAppointmentRequest,
  SendRemindersRequest,
  UpdateAppointmentDetailsRequest,
} from '../../src/index.js';

function fakeFetch(status: number, body: unknown) {
  const calls: { url: string; init: RequestInit }[] = [];
  const fn = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return new Response(JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json' },
    });
  }) as unknown as typeof fetch;
  return { fn, calls };
}

const client = (fn: typeof fetch) =>
  createSchedulingClient(createRequest({ baseUrl: '/api/v1', fetch: fn }));
const id = '0199c0b0-0a10-7000-8000-000000000001';
const staff = '0199c0a0-0b00-7000-8000-000000000001';
const type = '0199c0b0-0e10-7000-8000-000000000001';
const form = {
  idempotencyKey: '0199c0b0-1111-7000-8000-000000000001',
  contact: { kind: 'CLIENT' as const, id },
  typeId: type,
  startsAt: '2026-10-15T14:00:00.000Z',
  endsAt: '2026-10-15T15:00:00.000Z',
  method: 'VIDEO' as const,
  staffUserIds: [staff],
};

describe('api.scheduling', () => {
  it('fills the defaults of a new appointment', () => {
    const parsed = ScheduleAppointmentRequest.parse(form);
    expect(parsed).toMatchObject({
      allDay: false,
      generateVideoLink: false,
      status: 'CONFIRMED',
      reminders: [],
      sendConfirmation: true,
    });
  });

  it('refuses an end before the start and a missing staff member', () => {
    expect(ScheduleAppointmentRequest.safeParse({ ...form, endsAt: form.startsAt }).success).toBe(
      false,
    );
    expect(ScheduleAppointmentRequest.safeParse({ ...form, staffUserIds: [] }).success).toBe(false);
  });

  it('takes a new contact with an email', () => {
    const contact = { kind: 'CONTACT', name: 'Pat Sample', email: 'PAT@example.test' };
    const parsed = ScheduleAppointmentRequest.parse({ ...form, contact });
    expect(parsed.contact).toMatchObject({ email: 'pat@example.test', clientType: 'INDIVIDUAL' });
  });

  it('never resets unsent fields on Edit Existing', () => {
    const parsed = UpdateAppointmentDetailsRequest.parse({ version: 'v1', internalNotes: 'x' });
    expect(parsed).toEqual({ version: 'v1', internalNotes: 'x' });
    expect(UpdateAppointmentDetailsRequest.safeParse({ internalNotes: 'x' }).success).toBe(false);
  });

  it('sends reminders for ids or days, not both', () => {
    expect(SendRemindersRequest.safeParse({ withinDays: 7 }).success).toBe(true);
    expect(SendRemindersRequest.safeParse({ withinDays: 7, appointmentIds: [id] }).success).toBe(
      false,
    );
    expect(SendRemindersRequest.safeParse({}).success).toBe(false);
  });

  it('reads the agenda with its filters and Busy entries', async () => {
    const page = {
      timezone: 'America/New_York',
      items: [
        {
          restricted: true,
          id,
          startsAt: form.startsAt,
          endsAt: form.endsAt,
          staff: [{ userId: staff, name: 'Morgan Avery' }],
          status: 'CONFIRMED',
        },
      ],
      nextCursor: null,
    };
    const { fn, calls } = fakeFetch(200, page);
    const result = await client(fn).agenda({
      from: '2026-10-11T04:00:00.000Z',
      to: '2026-10-18T04:00:00.000Z',
      search: 'tax',
    });
    expect(calls[0]?.url).toBe(
      '/api/v1/business/appointments/agenda?from=2026-10-11T04%3A00%3A00.000Z&to=2026-10-18T04%3A00%3A00.000Z&search=tax&limit=200',
    );
    expect(AgendaPage.parse(result).items[0]?.restricted).toBe(true);
  });

  it("asks for one staff member's day", async () => {
    const { fn, calls } = fakeFetch(500, {});
    await client(fn)
      .staffDay({ staffUserId: staff, date: '2026-10-15' })
      .catch(() => undefined);
    expect(calls[0]?.url).toBe(
      `/api/v1/business/availability/day?staffUserId=${staff}&date=2026-10-15`,
    );
  });
});
