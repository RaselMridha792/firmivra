import { describe, expect, it } from 'vitest';
import {
  ApiRequestError,
  ConflictCheckRequest,
  CreateEquipmentRequest,
  CreateRoomRequest,
  createAppointmentResourcesClient,
  createRequest,
  SchedulingOptions,
  ScheduleAppointmentRequest,
  UpdateEquipmentRequest,
} from '../../src/index.js';

// Appointments Review 2 (A2): rooms and equipment (resources.ts), and equipment on the
// scheduling form. Synthetic ids only.

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
  createAppointmentResourcesClient(createRequest({ baseUrl: '/api/v1', fetch: fn }));
const office = '0199c0b0-0f10-7000-8000-000000000001';
const item = '0199c0b0-0f30-7000-8000-000000000001';
const room = {
  id: '0199c0b0-0f20-7000-8000-000000000001',
  name: 'Room 1',
  office: { id: office, name: 'Main Office' },
  archivedAt: null,
  upcoming: 0,
  updatedAt: '2026-11-15T10:00:00.000Z',
};
const equipment = {
  id: item,
  name: 'Projector',
  description: null,
  office: null,
  archivedAt: null,
  upcoming: 2,
  updatedAt: '2026-11-15T10:00:00.000Z',
};

describe('api.appointmentResources', () => {
  it('lists, adds, renames and archives with the right method and path', async () => {
    const list = fakeFetch(200, { rooms: [room], equipment: [equipment], offices: [] });
    expect((await client(list.fn).list()).rooms).toEqual([room]);
    expect(list.calls[0]?.url).toBe('/api/v1/business/appointment-resources');

    const add = fakeFetch(201, room);
    await client(add.fn).addRoom({ officeId: office, name: '  Room 1 ' });
    expect(add.calls[0]?.url).toBe('/api/v1/business/appointment-resources/rooms');
    expect(add.calls[0]?.init.method).toBe('POST');
    expect(JSON.parse(String(add.calls[0]?.init.body))).toEqual({
      officeId: office,
      name: 'Room 1',
    });

    const rename = fakeFetch(200, room);
    await client(rename.fn).renameRoom(room.id, { name: 'Board Room' });
    expect(rename.calls[0]?.url).toBe(`/api/v1/business/appointment-resources/rooms/${room.id}`);
    expect(rename.calls[0]?.init.method).toBe('PATCH');

    const archive = fakeFetch(200, equipment);
    await client(archive.fn).archiveEquipment(item);
    expect(archive.calls[0]?.url).toBe(
      `/api/v1/business/appointment-resources/equipment/${item}/archive`,
    );
    const restore = fakeFetch(200, equipment);
    await client(restore.fn).restoreEquipment(item);
    expect(restore.calls[0]?.url).toBe(
      `/api/v1/business/appointment-resources/equipment/${item}/restore`,
    );
  });

  it('refuses a bad id or body before sending (400 VALIDATION_FAILED)', async () => {
    const { fn, calls } = fakeFetch(200, room);
    await expect(client(fn).renameRoom('not-an-id', { name: 'X' })).rejects.toBeInstanceOf(
      ApiRequestError,
    );
    await expect(client(fn).addRoom({ officeId: office, name: '' })).rejects.toMatchObject({
      status: 400,
      code: 'VALIDATION_FAILED',
    });
    expect(calls).toHaveLength(0);
  });

  it('keeps names to one line of 1 to 100 characters, and a description to 500', () => {
    expect(CreateRoomRequest.safeParse({ officeId: office, name: 'x'.repeat(101) }).success).toBe(
      false,
    );
    expect(CreateRoomRequest.safeParse({ officeId: office, name: 'Room‮1' }).success).toBe(false);
    expect(CreateEquipmentRequest.parse({ name: 'Pad', description: '' })).toEqual({
      name: 'Pad',
      description: null,
    });
    expect(
      CreateEquipmentRequest.safeParse({ name: 'Pad', description: 'd'.repeat(501) }).success,
    ).toBe(false);
    // An edit changes something.
    expect(UpdateEquipmentRequest.safeParse({}).success).toBe(false);
    expect(UpdateEquipmentRequest.parse({ officeId: null })).toEqual({ officeId: null });
  });
});

describe('equipment on the scheduling form', () => {
  const form = {
    idempotencyKey: '0199c0b0-1111-7000-8000-000000000001',
    contact: { kind: 'CLIENT' as const, id: '0199c0b0-0a10-7000-8000-000000000001' },
    typeId: '0199c0b0-0e10-7000-8000-000000000001',
    startsAt: '2026-10-15T14:00:00.000Z',
    endsAt: '2026-10-15T15:00:00.000Z',
    method: 'IN_PERSON' as const,
    staffUserIds: ['0199c0a0-0b00-7000-8000-000000000001'],
  };

  it('books up to five items, each once', () => {
    expect(
      ScheduleAppointmentRequest.parse({ ...form, equipmentIds: [item] }).equipmentIds,
    ).toEqual([item]);
    const six = Array.from({ length: 6 }, (_, i) => `0199c0b0-0f30-7000-8000-00000000000${i}`);
    expect(ScheduleAppointmentRequest.safeParse({ ...form, equipmentIds: six }).success).toBe(
      false,
    );
    expect(
      ScheduleAppointmentRequest.safeParse({ ...form, equipmentIds: [item, item.toUpperCase()] })
        .success,
    ).toBe(false);
    expect(
      ConflictCheckRequest.safeParse({
        staffUserIds: form.staffUserIds,
        startsAt: form.startsAt,
        endsAt: form.endsAt,
        equipmentIds: [item],
      }).success,
    ).toBe(true);
  });

  it("reads options without equipment as none (an API before A2's)", () => {
    const options = SchedulingOptions.parse({
      timezone: 'America/Chicago',
      types: [],
      services: [],
      staff: [],
      smsEnabled: false,
      portalEnabled: true,
      videoProvider: null,
      meetingLinkStaff: [],
    });
    expect(options.equipment).toEqual([]);
  });
});
