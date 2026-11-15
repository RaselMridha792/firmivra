import {
  ApiRequestError,
  type AppointmentResources,
  type AppointmentResourcesClient,
  CreateEquipmentRequest,
  CreateRoomRequest,
  type FirmEquipment,
  type FirmRoom,
  parseInput,
  UpdateEquipmentRequest,
  UpdateRoomRequest,
} from '@firmivra/types';
import { mockDelay } from '../lib/mock';

// `api.appointmentResources` in mock mode (Appointments Review 2, A2): Settings > Appointment
// Settings' rooms and equipment, with the API's rules (names, archive, Owner and Admin only). The
// scheduling mock books from the same store, so a room or item added here is offered there.

const uuid = (block: string, n: number) =>
  `0199c0b0-${block}-7000-8000-${String(n).padStart(12, '0')}`;
const fail = (status: number, code: string, message: string) =>
  new ApiRequestError(status, code, message);
const copy = <T>(value: T): T => structuredClone(value);
const now = () => new Date().toISOString();

/** The offices of the scheduling mock (Main Office, Riverside Office). */
export const MOCK_OFFICES = [
  { id: uuid('0f10', 1), name: 'Main Office' },
  { id: uuid('0f10', 2), name: 'Riverside Office' },
];
const [MAIN, RIVERSIDE] = MOCK_OFFICES as [
  (typeof MOCK_OFFICES)[number],
  (typeof MOCK_OFFICES)[number],
];

interface Store {
  rooms: FirmRoom[];
  equipment: FirmEquipment[];
  next: number;
}

let store: Store | undefined;

/** The one store of the mock, shared with the scheduling mock. */
export function resourceStore(): Store {
  store ??= {
    rooms: [
      { name: 'Conference Room 1', office: MAIN, upcoming: 2 },
      { name: 'Conference Room 2', office: MAIN, upcoming: 0 },
    ].map((r, i) => ({ ...r, id: uuid('0f20', i + 1), archivedAt: null, updatedAt: now() })),
    equipment: [
      {
        name: 'Projector',
        description: 'Ceiling projector with HDMI and USB-C',
        office: MAIN,
        upcoming: 1,
      },
      { name: 'Signature pad', description: null, office: null, upcoming: 0 },
      { name: 'Document scanner', description: null, office: RIVERSIDE, upcoming: 0 },
    ].map((e, i) => ({ ...e, id: uuid('0f30', i + 1), archivedAt: null, updatedAt: now() })),
    next: 10,
  };
  return store;
}

/** The live items, as the scheduling form's options list them. */
export const liveEquipment = () =>
  resourceStore()
    .equipment.filter((e) => !e.archivedAt)
    .map((e) => ({ id: e.id, name: e.name, officeId: e.office?.id ?? null }))
    .sort((a, b) => a.name.localeCompare(b.name));

/** The live rooms, as the scheduling form's options list them. */
export const liveRooms = () =>
  resourceStore()
    .rooms.filter((r) => !r.archivedAt)
    .map((r) => ({ id: r.id, name: r.name, officeId: r.office.id }))
    .sort((a, b) => a.name.localeCompare(b.name));

export function createAppointmentResourcesMock(
  options: { role?: 'OWNER' | 'ADMIN' | 'STAFF' } = {},
): AppointmentResourcesClient {
  const s = resourceStore();
  const managers = () => {
    if (options.role === 'STAFF') throw fail(403, 'FORBIDDEN', 'This action is not permitted');
  };
  const office = (id: string) => {
    const found = MOCK_OFFICES.find((o) => o.id === id);
    if (!found) throw fail(404, 'NOT_FOUND', 'Not found');
    return found;
  };
  const room = (id: string) => {
    const found = s.rooms.find((r) => r.id === id);
    if (!found) throw fail(404, 'NOT_FOUND', 'Not found');
    return found;
  };
  const item = (id: string) => {
    const found = s.equipment.find((e) => e.id === id);
    if (!found) throw fail(404, 'NOT_FOUND', 'Not found');
    return found;
  };
  const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();
  const roomTaken = (officeId: string, name: string, except?: string) => {
    if (s.rooms.some((r) => r.id !== except && r.office.id === officeId && same(r.name, name)))
      throw fail(409, 'DUPLICATE_NAME', 'This office already has a room with this name');
  };
  const itemTaken = (name: string, except?: string) => {
    if (s.equipment.some((e) => e.id !== except && !e.archivedAt && same(e.name, name)))
      throw fail(409, 'DUPLICATE_NAME', 'An item of equipment with this name already exists');
  };
  const byName = <T extends { name: string }>(rows: T[]) =>
    [...rows].sort((a, b) => a.name.localeCompare(b.name));

  return {
    list: async (): Promise<AppointmentResources> => {
      await mockDelay();
      managers();
      return copy({
        rooms: byName(s.rooms),
        equipment: byName(s.equipment),
        offices: MOCK_OFFICES,
      });
    },
    addRoom: async (body) => {
      await mockDelay();
      managers();
      const input = parseInput(CreateRoomRequest, body);
      roomTaken(input.officeId, input.name);
      const row: FirmRoom = {
        id: uuid('0f20', s.next++),
        name: input.name,
        office: office(input.officeId),
        archivedAt: null,
        upcoming: 0,
        updatedAt: now(),
      };
      s.rooms.push(row);
      return copy(row);
    },
    renameRoom: async (id, body) => {
      await mockDelay();
      managers();
      const input = parseInput(UpdateRoomRequest, body);
      const row = room(id);
      roomTaken(row.office.id, input.name, id);
      Object.assign(row, { name: input.name, updatedAt: now() });
      return copy(row);
    },
    archiveRoom: async (id) => {
      await mockDelay();
      managers();
      const row = room(id);
      row.archivedAt ??= now();
      return copy(row);
    },
    addEquipment: async (body) => {
      await mockDelay();
      managers();
      const input = parseInput(CreateEquipmentRequest, body);
      itemTaken(input.name);
      const row: FirmEquipment = {
        id: uuid('0f30', s.next++),
        name: input.name,
        description: input.description ?? null,
        office: input.officeId ? office(input.officeId) : null,
        archivedAt: null,
        upcoming: 0,
        updatedAt: now(),
      };
      s.equipment.push(row);
      return copy(row);
    },
    updateEquipment: async (id, body) => {
      await mockDelay();
      managers();
      const input = parseInput(UpdateEquipmentRequest, body);
      const row = item(id);
      if (input.name !== undefined && !row.archivedAt) itemTaken(input.name, id);
      Object.assign(row, {
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.description !== undefined ? { description: input.description } : {}),
        ...(input.officeId !== undefined
          ? { office: input.officeId ? office(input.officeId) : null }
          : {}),
        updatedAt: now(),
      });
      return copy(row);
    },
    archiveEquipment: async (id) => {
      await mockDelay();
      managers();
      const row = item(id);
      row.archivedAt ??= now();
      return copy(row);
    },
    restoreEquipment: async (id) => {
      await mockDelay();
      managers();
      const row = item(id);
      if (row.archivedAt) itemTaken(row.name, id);
      row.archivedAt = null;
      return copy(row);
    },
  };
}
