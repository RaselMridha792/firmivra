import { z } from 'zod';
import { clearable, text } from '../clients/text.js';
import { NamedItem } from './scheduling.js';

// Appointments Review 2 (A2), Settings > Appointment Settings: the firm's rooms and equipment.
// Owner and Admin manage them (Staff 403); everyone at the firm books them with an appointment
// (Schedule Appointment's Room and Equipment). A room is one office's; an item of equipment is one
// physical item, of one office or of any office (officeId null). Archived ones are listed for
// Restore, and a booked one keeps its appointments. Two live appointments never hold one room or
// one item at once: the conflict check names it (409 SCHEDULING_CONFLICT) and the database refuses
// it whatever the check saw. Audit rows hold ids only.

const DateTime = z.iso.datetime({ offset: true });

export const RoomId = z.uuid();
export const EquipmentId = z.uuid();

/** A room or an item's name: one line of 1 to 100 characters. */
export const ResourceName = text(100);

export const FirmRoom = z.object({
  id: z.uuid(),
  name: z.string(),
  office: NamedItem,
  /** Set when archived: no new bookings; its appointments keep it. */
  archivedAt: DateTime.nullable(),
  /** Live appointments from now on that hold it. */
  upcoming: z.number().int(),
  updatedAt: DateTime,
});
export type FirmRoom = z.infer<typeof FirmRoom>;

export const FirmEquipment = z.object({
  id: z.uuid(),
  name: z.string(),
  description: z.string().nullable(),
  /** Its office; null when it goes to any office. */
  office: NamedItem.nullable(),
  archivedAt: DateTime.nullable(),
  /** Live appointments from now on that hold it. */
  upcoming: z.number().int(),
  updatedAt: DateTime,
});
export type FirmEquipment = z.infer<typeof FirmEquipment>;

/** GET /business/appointment-resources: the settings page in one call. */
export const AppointmentResources = z.object({
  rooms: z.array(FirmRoom),
  equipment: z.array(FirmEquipment),
  /** The offices a room or item can belong to: not archived (an inactive one keeps its own). */
  offices: z.array(NamedItem),
});
export type AppointmentResources = z.infer<typeof AppointmentResources>;

/**
 * POST /business/appointment-resources/rooms. A name is unique within its office, archived rooms
 * included (409 DUPLICATE_NAME: restore that one instead).
 */
export const CreateRoomRequest = z.strictObject({ officeId: z.uuid(), name: ResourceName });
export type CreateRoomRequest = z.input<typeof CreateRoomRequest>;

/**
 * PATCH /business/appointment-resources/rooms/{id}: Rename. A room stays in its office (its
 * appointments are booked there).
 */
export const UpdateRoomRequest = z.strictObject({ name: ResourceName });
export type UpdateRoomRequest = z.input<typeof UpdateRoomRequest>;

/**
 * POST /business/appointment-resources/equipment. A name is unique among the firm's live items,
 * ignoring case (409 DUPLICATE_NAME); two projectors are "Projector 1" and "Projector 2".
 */
export const CreateEquipmentRequest = z.strictObject({
  name: ResourceName,
  description: clearable(text(500, 'many')),
  /** Null or left out: any office. */
  officeId: z.uuid().nullable().optional(),
});
export type CreateEquipmentRequest = z.input<typeof CreateEquipmentRequest>;

/**
 * PATCH /business/appointment-resources/equipment/{id}: what it leaves out stays. A move to
 * another office keeps the item's appointments; new bookings follow its new office.
 */
export const UpdateEquipmentRequest = z
  .strictObject({
    name: ResourceName.optional(),
    description: clearable(text(500, 'many')),
    officeId: z.uuid().nullable().optional(),
  })
  .refine((b) => Object.keys(b).length > 0, { message: 'Change something first' });
export type UpdateEquipmentRequest = z.input<typeof UpdateEquipmentRequest>;

export const AppointmentResourcesErrorCode = z.enum([
  'VALIDATION_FAILED',
  'NOT_FOUND',
  'FORBIDDEN',
  /** A live room of that office, or a live item, has this name already. */
  'DUPLICATE_NAME',
]);
export type AppointmentResourcesErrorCode = z.infer<typeof AppointmentResourcesErrorCode>;
