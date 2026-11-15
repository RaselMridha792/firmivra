import { type ApiRequest, parseInput } from '../client.js';
import {
  AppointmentResources,
  CreateEquipmentRequest,
  CreateRoomRequest,
  EquipmentId,
  FirmEquipment,
  FirmRoom,
  RoomId,
  UpdateEquipmentRequest,
  UpdateRoomRequest,
} from './resources.js';

const RESOURCES = '/business/appointment-resources';
const room = (id: string) => `${RESOURCES}/rooms/${parseInput(RoomId, id)}`;
const item = (id: string) => `${RESOURCES}/equipment/${parseInput(EquipmentId, id)}`;
const post = (body?: unknown) => ({ method: 'POST', ...(body === undefined ? {} : { body }) });
const patch = (body: unknown) => ({ method: 'PATCH', body });

/**
 * `api.appointmentResources` (apps/web/src/lib/api.ts): Settings > Appointment Settings' Rooms and
 * Equipment (Appointments Review 2, A2). Owner and Admin; Staff get 403. Bad input rejects with
 * ApiRequestError(400, 'VALIDATION_FAILED'); a name already in use with 409 DUPLICATE_NAME.
 */
export function createAppointmentResourcesClient(request: ApiRequest) {
  return {
    /** Every room and item, archived ones too, with the offices they can belong to. */
    list: async (): Promise<AppointmentResources> => request(AppointmentResources, RESOURCES),
    addRoom: async (body: CreateRoomRequest): Promise<FirmRoom> =>
      request(FirmRoom, `${RESOURCES}/rooms`, post(parseInput(CreateRoomRequest, body))),
    renameRoom: async (id: string, body: UpdateRoomRequest): Promise<FirmRoom> =>
      request(FirmRoom, room(id), patch(parseInput(UpdateRoomRequest, body))),
    /** For good: no new bookings; its appointments keep it. */
    archiveRoom: async (id: string): Promise<FirmRoom> =>
      request(FirmRoom, `${room(id)}/archive`, post()),
    addEquipment: async (body: CreateEquipmentRequest): Promise<FirmEquipment> =>
      request(
        FirmEquipment,
        `${RESOURCES}/equipment`,
        post(parseInput(CreateEquipmentRequest, body)),
      ),
    updateEquipment: async (id: string, body: UpdateEquipmentRequest): Promise<FirmEquipment> =>
      request(FirmEquipment, item(id), patch(parseInput(UpdateEquipmentRequest, body))),
    archiveEquipment: async (id: string): Promise<FirmEquipment> =>
      request(FirmEquipment, `${item(id)}/archive`, post()),
    /** 409 DUPLICATE_NAME when a live item took its name meanwhile. */
    restoreEquipment: async (id: string): Promise<FirmEquipment> =>
      request(FirmEquipment, `${item(id)}/restore`, post()),
  };
}

export type AppointmentResourcesClient = ReturnType<typeof createAppointmentResourcesClient>;
