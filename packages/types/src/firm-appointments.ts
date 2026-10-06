import { z } from 'zod';

export const AppointmentIdempotencyKey = z.string().min(8).max(128);

// Shared contract for docs/api/firm/appointments.yaml; policy validation also runs in the service.
export const FirmAppointment = z.strictObject({
  id: z.uuid(),
  clientId: z.uuid(),
  clientName: z
    .string()
    .refine((value) => value.trim().length > 0, 'Cannot be blank')
    .min(1)
    .max(200),
  providerMembershipId: z.uuid(),
  providerName: z
    .string()
    .refine((value) => value.trim().length > 0, 'Cannot be blank')
    .min(1)
    .max(200),
  typeId: z.uuid(),
  typeName: z
    .string()
    .refine((value) => value.trim().length > 0, 'Cannot be blank')
    .min(1)
    .max(120),
  startsAt: z.iso.datetime({ offset: true }),
  endsAt: z.iso.datetime({ offset: true }),
  timezone: z
    .string()
    .refine((value) => value.trim().length > 0, 'Cannot be blank')
    .min(1)
    .max(100)
    .refine((value) => {
      try {
        new Intl.DateTimeFormat('en', { timeZone: value });
        return true;
      } catch {
        return false;
      }
    }, 'Invalid IANA timezone'),
  method: z.enum(['PHONE', 'VIDEO', 'IN_PERSON']),
  location: z.string().max(500).nullable(),
  meetingUrl: z.url().max(2048).regex(new RegExp('^https://')).nullable(),
  instructions: z.string().max(2000).nullable(),
  status: z.enum(['BOOKED', 'CANCELLED', 'COMPLETED', 'NO_SHOW']),
  version: z.number().int().min(1),
  createdAt: z.iso.datetime({ offset: true }),
  updatedAt: z.iso.datetime({ offset: true }),
});
export type FirmAppointment = z.infer<typeof FirmAppointment>;

export const FirmAppointmentTypeInput = z.strictObject({
  name: z
    .string()
    .refine((value) => value.trim().length > 0, 'Cannot be blank')
    .min(1)
    .max(120),
  durationMinutes: z.number().int().min(1).max(480),
  bufferBeforeMinutes: z.number().int().min(0).max(120),
  bufferAfterMinutes: z.number().int().min(0).max(120),
  allowedMethods: z
    .array(z.enum(['PHONE', 'VIDEO', 'IN_PERSON']))
    .min(1)
    .max(3)
    .refine((value) => new Set(value).size === value.length, 'Duplicate values'),
  clientBookingEnabled: z.boolean(),
  active: z.boolean(),
  isIntroCall: z.boolean().optional().default(false),
});
export type FirmAppointmentTypeInput = z.infer<typeof FirmAppointmentTypeInput>;

export const FirmAppointmentTypePatch = z
  .strictObject({
    name: z
      .string()
      .refine((value) => value.trim().length > 0, 'Cannot be blank')
      .min(1)
      .max(120)
      .optional(),
    durationMinutes: z.number().int().min(1).max(480).optional(),
    bufferBeforeMinutes: z.number().int().min(0).max(120).optional(),
    bufferAfterMinutes: z.number().int().min(0).max(120).optional(),
    allowedMethods: z
      .array(z.enum(['PHONE', 'VIDEO', 'IN_PERSON']))
      .min(1)
      .max(3)
      .refine((value) => new Set(value).size === value.length, 'Duplicate values')
      .optional(),
    clientBookingEnabled: z.boolean().optional(),
    active: z.boolean().optional(),
    isIntroCall: z.boolean().optional(),
  })
  .refine((value) => Object.keys(value).length >= 1, 'Supply at least 1 fields');
export type FirmAppointmentTypePatch = z.infer<typeof FirmAppointmentTypePatch>;

export const FirmAppointmentType = z.strictObject({
  id: z.uuid(),
  name: z
    .string()
    .refine((value) => value.trim().length > 0, 'Cannot be blank')
    .min(1)
    .max(120),
  durationMinutes: z.number().int().min(1).max(480),
  bufferBeforeMinutes: z.number().int().min(0).max(120),
  bufferAfterMinutes: z.number().int().min(0).max(120),
  allowedMethods: z
    .array(z.enum(['PHONE', 'VIDEO', 'IN_PERSON']))
    .min(1)
    .max(3)
    .refine((value) => new Set(value).size === value.length, 'Duplicate values'),
  clientBookingEnabled: z.boolean(),
  active: z.boolean(),
  createdAt: z.iso.datetime({ offset: true }),
  updatedAt: z.iso.datetime({ offset: true }),
  isIntroCall: z.boolean(),
});
export type FirmAppointmentType = z.infer<typeof FirmAppointmentType>;

export const FirmWorkingHours = z.strictObject({
  weekday: z.number().int().min(0).max(6),
  startMinute: z.number().int().min(0).max(1439),
  endMinute: z.number().int().min(1).max(1440),
});
export type FirmWorkingHours = z.infer<typeof FirmWorkingHours>;

export const FirmBlockedTimeInput = z.strictObject({
  providerMembershipId: z.uuid(),
  startsAt: z.iso.datetime({ offset: true }),
  endsAt: z.iso.datetime({ offset: true }),
  reason: z.string().max(500).nullable(),
});
export type FirmBlockedTimeInput = z.infer<typeof FirmBlockedTimeInput>;

export const FirmBlockedTime = z.strictObject({
  id: z.uuid(),
  providerMembershipId: z.uuid(),
  startsAt: z.iso.datetime({ offset: true }),
  endsAt: z.iso.datetime({ offset: true }),
  reason: z.string().max(500).nullable(),
  createdAt: z.iso.datetime({ offset: true }),
});
export type FirmBlockedTime = z.infer<typeof FirmBlockedTime>;

export const FirmAppointmentHistory = z.strictObject({
  id: z.uuid(),
  action: z.enum(['BOOKED', 'RESCHEDULED', 'CANCELLED', 'DETAILS_UPDATED', 'COMPLETED', 'NO_SHOW']),
  previousStartsAt: z.iso.datetime({ offset: true }).nullable(),
  previousEndsAt: z.iso.datetime({ offset: true }).nullable(),
  previousStatus: z.enum(['BOOKED', 'CANCELLED', 'COMPLETED', 'NO_SHOW']).nullable(),
  newStartsAt: z.iso.datetime({ offset: true }),
  newEndsAt: z.iso.datetime({ offset: true }),
  newStatus: z.enum(['BOOKED', 'CANCELLED', 'COMPLETED', 'NO_SHOW']),
  createdAt: z.iso.datetime({ offset: true }),
});
export type FirmAppointmentHistory = z.infer<typeof FirmAppointmentHistory>;

export const ListFirmAppointmentTypesResponse = z.strictObject({
  items: z.array(z.lazy(() => FirmAppointmentType)).max(100),
});
export type ListFirmAppointmentTypesResponse = z.infer<typeof ListFirmAppointmentTypesResponse>;

export const CreateAppointmentTypeRequest = z.lazy(() => FirmAppointmentTypeInput);
export type CreateAppointmentTypeRequest = z.infer<typeof CreateAppointmentTypeRequest>;

export const CreateAppointmentTypeResponse = z.lazy(() => FirmAppointmentType);
export type CreateAppointmentTypeResponse = z.infer<typeof CreateAppointmentTypeResponse>;

export const UpdateAppointmentTypeRequest = z.lazy(() => FirmAppointmentTypePatch);
export type UpdateAppointmentTypeRequest = z.infer<typeof UpdateAppointmentTypeRequest>;

export const UpdateAppointmentTypeResponse = z.lazy(() => FirmAppointmentType);
export type UpdateAppointmentTypeResponse = z.infer<typeof UpdateAppointmentTypeResponse>;

export const GetProviderWorkingHoursResponse = z.strictObject({
  items: z.array(z.lazy(() => FirmWorkingHours)).max(50),
});
export type GetProviderWorkingHoursResponse = z.infer<typeof GetProviderWorkingHoursResponse>;

export const ReplaceProviderWorkingHoursRequest = z.strictObject({
  items: z.array(z.lazy(() => FirmWorkingHours)).max(50),
});
export type ReplaceProviderWorkingHoursRequest = z.infer<typeof ReplaceProviderWorkingHoursRequest>;

export const ReplaceProviderWorkingHoursResponse = z.strictObject({
  items: z.array(z.lazy(() => FirmWorkingHours)).max(50),
});
export type ReplaceProviderWorkingHoursResponse = z.infer<
  typeof ReplaceProviderWorkingHoursResponse
>;

export const ListProviderBlockedTimeQuery = z.strictObject({
  cursor: z.string().max(500).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional().default(25),
  providerMembershipId: z.uuid(),
  from: z.iso.datetime({ offset: true }),
  to: z.iso.datetime({ offset: true }),
});
export type ListProviderBlockedTimeQuery = z.infer<typeof ListProviderBlockedTimeQuery>;

export const ListProviderBlockedTimeResponse = z.strictObject({
  items: z.array(z.lazy(() => FirmBlockedTime)).max(100),
  nextCursor: z.string().max(500).nullable(),
});
export type ListProviderBlockedTimeResponse = z.infer<typeof ListProviderBlockedTimeResponse>;

export const CreateProviderBlockedTimeRequest = z.lazy(() => FirmBlockedTimeInput);
export type CreateProviderBlockedTimeRequest = z.infer<typeof CreateProviderBlockedTimeRequest>;

export const CreateProviderBlockedTimeResponse = z.lazy(() => FirmBlockedTime);
export type CreateProviderBlockedTimeResponse = z.infer<typeof CreateProviderBlockedTimeResponse>;

export const RemoveProviderBlockedTimeResponse = z.strictObject({ ok: z.literal(true) });
export type RemoveProviderBlockedTimeResponse = z.infer<typeof RemoveProviderBlockedTimeResponse>;

export const ListFirmAppointmentsQuery = z.strictObject({
  cursor: z.string().max(500).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional().default(25),
  from: z.iso.datetime({ offset: true }),
  to: z.iso.datetime({ offset: true }),
  status: z.enum(['BOOKED', 'CANCELLED', 'COMPLETED', 'NO_SHOW']).optional(),
  providerMembershipId: z.uuid().optional(),
});
export type ListFirmAppointmentsQuery = z.infer<typeof ListFirmAppointmentsQuery>;

export const ListFirmAppointmentsResponse = z.strictObject({
  items: z.array(z.lazy(() => FirmAppointment)).max(100),
  nextCursor: z.string().max(500).nullable(),
});
export type ListFirmAppointmentsResponse = z.infer<typeof ListFirmAppointmentsResponse>;

export const BookFirmAppointmentRequest = z.strictObject({
  typeId: z.uuid(),
  providerMembershipId: z.uuid(),
  startsAt: z.iso.datetime({ offset: true }),
  method: z.enum(['PHONE', 'VIDEO', 'IN_PERSON']),
  clientId: z.uuid(),
});
export type BookFirmAppointmentRequest = z.infer<typeof BookFirmAppointmentRequest>;

export const BookFirmAppointmentResponse = z.lazy(() => FirmAppointment);
export type BookFirmAppointmentResponse = z.infer<typeof BookFirmAppointmentResponse>;

export const ListFirmAvailableSlotsQuery = z.strictObject({
  providerMembershipId: z.uuid(),
  typeId: z.uuid(),
  from: z.iso.datetime({ offset: true }),
  to: z.iso.datetime({ offset: true }),
});
export type ListFirmAvailableSlotsQuery = z.infer<typeof ListFirmAvailableSlotsQuery>;

export const ListFirmAvailableSlotsResponse = z.strictObject({
  timezone: z
    .string()
    .refine((value) => value.trim().length > 0, 'Cannot be blank')
    .min(1)
    .max(100)
    .refine((value) => {
      try {
        new Intl.DateTimeFormat('en', { timeZone: value });
        return true;
      } catch {
        return false;
      }
    }, 'Invalid IANA timezone'),
  slots: z
    .array(
      z.strictObject({
        startsAt: z.iso.datetime({ offset: true }),
        endsAt: z.iso.datetime({ offset: true }),
      }),
    )
    .max(1000),
  nextFrom: z.iso.datetime({ offset: true }).nullable(),
});
export type ListFirmAvailableSlotsResponse = z.infer<typeof ListFirmAvailableSlotsResponse>;

export const ListFirmAppointmentProvidersQuery = z.strictObject({
  typeId: z.uuid(),
  cursor: z.string().max(500).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional().default(25),
});
export type ListFirmAppointmentProvidersQuery = z.infer<typeof ListFirmAppointmentProvidersQuery>;

export const ListFirmAppointmentProvidersResponse = z.strictObject({
  items: z
    .array(
      z.strictObject({
        id: z.uuid(),
        name: z
          .string()
          .refine((value) => value.trim().length > 0, 'Cannot be blank')
          .min(1)
          .max(200),
      }),
    )
    .max(100),
  nextCursor: z.string().max(500).nullable(),
});
export type ListFirmAppointmentProvidersResponse = z.infer<
  typeof ListFirmAppointmentProvidersResponse
>;

export const GetFirmAppointmentResponse = z.lazy(() => FirmAppointment);
export type GetFirmAppointmentResponse = z.infer<typeof GetFirmAppointmentResponse>;

export const UpdateFirmAppointmentDetailsRequest = z
  .strictObject({
    expectedVersion: z.number().int().min(1),
    location: z.string().max(500).nullable().optional(),
    meetingUrl: z.url().max(2048).regex(new RegExp('^https://')).nullable().optional(),
    instructions: z.string().max(2000).nullable().optional(),
  })
  .refine((value) => Object.keys(value).length >= 2, 'Supply at least 2 fields');
export type UpdateFirmAppointmentDetailsRequest = z.infer<
  typeof UpdateFirmAppointmentDetailsRequest
>;

export const UpdateFirmAppointmentDetailsResponse = z.lazy(() => FirmAppointment);
export type UpdateFirmAppointmentDetailsResponse = z.infer<
  typeof UpdateFirmAppointmentDetailsResponse
>;

export const RescheduleFirmAppointmentRequest = z.strictObject({
  startsAt: z.iso.datetime({ offset: true }),
  expectedVersion: z.number().int().min(1),
});
export type RescheduleFirmAppointmentRequest = z.infer<typeof RescheduleFirmAppointmentRequest>;

export const RescheduleFirmAppointmentResponse = z.lazy(() => FirmAppointment);
export type RescheduleFirmAppointmentResponse = z.infer<typeof RescheduleFirmAppointmentResponse>;

export const CancelFirmAppointmentRequest = z.strictObject({
  expectedVersion: z.number().int().min(1),
  reason: z.string().max(500).optional(),
});
export type CancelFirmAppointmentRequest = z.infer<typeof CancelFirmAppointmentRequest>;

export const CancelFirmAppointmentResponse = z.lazy(() => FirmAppointment);
export type CancelFirmAppointmentResponse = z.infer<typeof CancelFirmAppointmentResponse>;

export const ListFirmAppointmentHistoryQuery = z.strictObject({
  cursor: z.string().max(500).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional().default(25),
});
export type ListFirmAppointmentHistoryQuery = z.infer<typeof ListFirmAppointmentHistoryQuery>;

export const ListFirmAppointmentHistoryResponse = z.strictObject({
  items: z.array(z.lazy(() => FirmAppointmentHistory)).max(100),
  nextCursor: z.string().max(500).nullable(),
});
export type ListFirmAppointmentHistoryResponse = z.infer<typeof ListFirmAppointmentHistoryResponse>;

export const ListPortalAppointmentsQuery = z.strictObject({
  cursor: z.string().max(500).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional().default(25),
  from: z.iso.datetime({ offset: true }),
  to: z.iso.datetime({ offset: true }),
  status: z.enum(['BOOKED', 'CANCELLED', 'COMPLETED', 'NO_SHOW']).optional(),
});
export type ListPortalAppointmentsQuery = z.infer<typeof ListPortalAppointmentsQuery>;

export const ListPortalAppointmentsResponse = z.strictObject({
  items: z.array(z.lazy(() => FirmAppointment)).max(100),
  nextCursor: z.string().max(500).nullable(),
});
export type ListPortalAppointmentsResponse = z.infer<typeof ListPortalAppointmentsResponse>;

export const BookPortalAppointmentRequest = z.strictObject({
  typeId: z.uuid(),
  providerMembershipId: z.uuid(),
  startsAt: z.iso.datetime({ offset: true }),
  method: z.enum(['PHONE', 'VIDEO', 'IN_PERSON']),
});
export type BookPortalAppointmentRequest = z.infer<typeof BookPortalAppointmentRequest>;

export const BookPortalAppointmentResponse = z.lazy(() => FirmAppointment);
export type BookPortalAppointmentResponse = z.infer<typeof BookPortalAppointmentResponse>;

export const ListPortalAvailableSlotsQuery = z.strictObject({
  providerMembershipId: z.uuid(),
  typeId: z.uuid(),
  from: z.iso.datetime({ offset: true }),
  to: z.iso.datetime({ offset: true }),
});
export type ListPortalAvailableSlotsQuery = z.infer<typeof ListPortalAvailableSlotsQuery>;

export const ListPortalAvailableSlotsResponse = z.strictObject({
  timezone: z
    .string()
    .refine((value) => value.trim().length > 0, 'Cannot be blank')
    .min(1)
    .max(100)
    .refine((value) => {
      try {
        new Intl.DateTimeFormat('en', { timeZone: value });
        return true;
      } catch {
        return false;
      }
    }, 'Invalid IANA timezone'),
  slots: z
    .array(
      z.strictObject({
        startsAt: z.iso.datetime({ offset: true }),
        endsAt: z.iso.datetime({ offset: true }),
      }),
    )
    .max(1000),
  nextFrom: z.iso.datetime({ offset: true }).nullable(),
});
export type ListPortalAvailableSlotsResponse = z.infer<typeof ListPortalAvailableSlotsResponse>;

export const ListPortalAppointmentProvidersQuery = z.strictObject({
  typeId: z.uuid(),
  cursor: z.string().max(500).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional().default(25),
});
export type ListPortalAppointmentProvidersQuery = z.infer<
  typeof ListPortalAppointmentProvidersQuery
>;

export const ListPortalAppointmentProvidersResponse = z.strictObject({
  items: z
    .array(
      z.strictObject({
        id: z.uuid(),
        name: z
          .string()
          .refine((value) => value.trim().length > 0, 'Cannot be blank')
          .min(1)
          .max(200),
      }),
    )
    .max(100),
  nextCursor: z.string().max(500).nullable(),
});
export type ListPortalAppointmentProvidersResponse = z.infer<
  typeof ListPortalAppointmentProvidersResponse
>;

export const GetPortalAppointmentResponse = z.lazy(() => FirmAppointment);
export type GetPortalAppointmentResponse = z.infer<typeof GetPortalAppointmentResponse>;

export const ReschedulePortalAppointmentRequest = z.strictObject({
  startsAt: z.iso.datetime({ offset: true }),
  expectedVersion: z.number().int().min(1),
});
export type ReschedulePortalAppointmentRequest = z.infer<typeof ReschedulePortalAppointmentRequest>;

export const ReschedulePortalAppointmentResponse = z.lazy(() => FirmAppointment);
export type ReschedulePortalAppointmentResponse = z.infer<
  typeof ReschedulePortalAppointmentResponse
>;

export const CancelPortalAppointmentRequest = z.strictObject({
  expectedVersion: z.number().int().min(1),
  reason: z.string().max(500).optional(),
});
export type CancelPortalAppointmentRequest = z.infer<typeof CancelPortalAppointmentRequest>;

export const CancelPortalAppointmentResponse = z.lazy(() => FirmAppointment);
export type CancelPortalAppointmentResponse = z.infer<typeof CancelPortalAppointmentResponse>;

export const ListPortalAppointmentHistoryQuery = z.strictObject({
  cursor: z.string().max(500).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional().default(25),
});
export type ListPortalAppointmentHistoryQuery = z.infer<typeof ListPortalAppointmentHistoryQuery>;

export const ListPortalAppointmentHistoryResponse = z.strictObject({
  items: z.array(z.lazy(() => FirmAppointmentHistory)).max(100),
  nextCursor: z.string().max(500).nullable(),
});
export type ListPortalAppointmentHistoryResponse = z.infer<
  typeof ListPortalAppointmentHistoryResponse
>;

export const ListPortalAppointmentTypesResponse = z.strictObject({
  items: z.array(z.lazy(() => FirmAppointmentType)).max(100),
});
export type ListPortalAppointmentTypesResponse = z.infer<typeof ListPortalAppointmentTypesResponse>;
