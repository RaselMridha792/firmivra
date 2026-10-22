import { z } from 'zod';
import {
  FirmOfficeActionKind,
  FirmOfficeActionStatus,
  FirmOfficeKind,
  FirmOfficeStatus,
  MembershipRole,
  ServiceKind,
} from '../db-enums.js';
import { text } from '../clients/text.js';
import { AdminActivityItem } from './activity.js';

// Settings > Locations (R1, Oct 21; docs/specs/settings-review-2026-10-20/locations--*.md and the
// mockups in docs/mockups/firm-workspace/settings/review-2026-10-20/locations/). A location is a
// firm_offices row: an OFFICE with a street address or a VIRTUAL one without. All routes are
// Owner and Admin; deactivating a location or a manager, and editing or cancelling a scheduled
// action, are the "Super Administrator"'s: the Owner, and an Admin with MANAGE on SETTINGS
// (Rasel, Oct 21, as for MFA). Locations are never deleted (Activate / Deactivate).
//
// Errors: 409 DUPLICATE_LOCATION (message LOCATION_DUPLICATE_MESSAGE: the same address, or the
// same name, as another live location; the same EIN or business name alone never blocks),
// 409 LOCATION_LIMIT (the plan's locations are used), 409 SAVE_CONFLICT (`expectedUpdatedAt` is
// stale), 409 LOCATION_IS_PRIMARY (deactivate the main location: set another as primary first),
// 409 PENDING_ACTION_EXISTS (one scheduled change per location and per manager), 409
// ACTION_FINISHED (a done, cancelled or failed action never changes), 400 MANAGER_NOT_ELIGIBLE
// (not an active member of the firm), 403 FORBIDDEN (a Super Administrator action).

const DateTime = z.iso.datetime({ offset: true });
/** Trimmed, 1 to `max` characters, no control or invisible characters (clients/text.ts). */
const line = (max: number) => text(max);
const optionalLine = (max: number) => line(max).nullish();

/** The exact words for a duplicate location (Locations guide, final decision 5). */
export const LOCATION_DUPLICATE_MESSAGE =
  'This location already exists. Please review the existing location before continuing.';

/** E.164 (+15551234567): the screen formats what is typed. */
export const LocationPhone = z
  .string()
  .trim()
  .regex(/^\+[1-9][0-9]{6,14}$/, 'Enter a phone number with its country code');
export const LocationEmail = z
  .email('Enter an email address')
  .max(254)
  .transform((v) => v.toLowerCase());
/** A US ZIP code: 12345 or 12345-6789. */
export const LocationZip = z
  .string()
  .trim()
  .regex(/^[0-9]{5}(-[0-9]{4})?$/, 'Enter a 5-digit ZIP code');
/** "09:00": 24-hour time of day, in the location's time zone. */
export const LocationTime = z
  .string()
  .regex(/^([01][0-9]|2[0-3]):[0-5][0-9]$/, 'Use a time like 09:00');

/** One open interval of a day. A day without intervals is closed. */
export const LocationHoursInterval = z
  .object({
    /** 0 Sunday to 6 Saturday. */
    weekday: z.number().int().min(0).max(6),
    opensAt: LocationTime,
    closesAt: LocationTime,
  })
  .refine((i) => i.opensAt < i.closesAt, {
    path: ['closesAt'],
    message: 'Closing time must be after opening time',
  });
export type LocationHoursInterval = z.infer<typeof LocationHoursInterval>;

/** A week's intervals: up to 6 a day, never overlapping (touching is fine: 12:00 then 12:00). */
export const LocationHours = z
  .array(LocationHoursInterval)
  .max(42)
  .superRefine((hours, ctx) => {
    for (let a = 0; a < hours.length; a++) {
      for (let b = a + 1; b < hours.length; b++) {
        const x = hours[a]!;
        const y = hours[b]!;
        if (x.weekday === y.weekday && x.opensAt < y.closesAt && y.opensAt < x.closesAt) {
          ctx.addIssue({ code: 'custom', path: [b], message: 'These hours overlap' });
        }
      }
    }
  });

/** A person on a location: its manager, or a member assigned to it. */
export const LocationPerson = z.object({
  /** memberships.user_id. */
  userId: z.uuid(),
  name: z.string(),
  jobTitle: z.string().nullable(),
  email: z.string().nullable(),
  phone: z.string().nullable(),
});
export type LocationPerson = z.infer<typeof LocationPerson>;

/** A Services & Pricing service a location offers. */
export const LocationService = z.object({ id: z.uuid(), name: z.string(), kind: ServiceKind });
export type LocationService = z.infer<typeof LocationService>;

/** A scheduled Locations change (Locations guide, final decisions 1 and 2). */
export const LocationAction = z.object({
  id: z.uuid(),
  kind: FirmOfficeActionKind,
  status: FirmOfficeActionStatus,
  /** The location; null for DEACTIVATE_MANAGER (every location the manager runs). */
  locationId: z.uuid().nullable(),
  locationName: z.string().nullable(),
  /** DEACTIVATE_MANAGER: the manager; REASSIGN_MANAGER: the one replaced (null if unassigned). */
  manager: LocationPerson.nullable(),
  /** The new manager; null on DEACTIVATE_MANAGER means the main location's manager acts. */
  newManager: LocationPerson.nullable(),
  /** When it runs (shown in the location's time zone). */
  effectiveAt: DateTime,
  /** The first time it was set for, kept when it is moved. */
  originalEffectiveAt: DateTime,
  createdBy: z.object({ userId: z.uuid(), name: z.string() }),
  createdAt: DateTime,
  /** When it ran, was cancelled or failed; null while PENDING. */
  finishedAt: DateTime.nullable(),
  /** FAILED only: NEW_MANAGER_INACTIVE, LOCATION_IS_PRIMARY, ... */
  failureCode: z.string().nullable(),
});
export type LocationAction = z.infer<typeof LocationAction>;

/** A row of the Locations table (and of Settings > Overview's Location Management). */
export const LocationRow = z.object({
  id: z.uuid(),
  name: z.string(),
  kind: FirmOfficeKind,
  status: FirmOfficeStatus,
  /** The primary location: at most one, always ACTIVE. */
  isMain: z.boolean(),
  addressLine1: z.string().nullable(),
  addressLine2: z.string().nullable(),
  city: z.string().nullable(),
  state: z.string().nullable(),
  postalCode: z.string().nullable(),
  /** The members assigned to it (firm_office_members), the manager not counted unless assigned. */
  staffCount: z.number().int().nonnegative(),
  /**
   * Who runs it: its manager, or (no manager) the main location's manager, then `managerIsActing`.
   * Null when there is neither.
   */
  manager: LocationPerson.nullable(),
  managerIsActing: z.boolean(),
  /** Its scheduled change, if one is pending. */
  pendingAction: LocationAction.nullable(),
});
export type LocationRow = z.infer<typeof LocationRow>;

/** The KPI cards: Total Locations, Active Locations, Subscription Usage "2 / 5". */
export const LocationsKpis = z.object({
  total: z.number().int().nonnegative(),
  active: z.number().int().nonnegative(),
  /** Locations in use (ACTIVE) and what the plan allows; null when the plan sets no limit. */
  subscription: z.object({
    used: z.number().int().nonnegative(),
    allowed: z.number().int().nonnegative().nullable(),
  }),
});
export type LocationsKpis = z.infer<typeof LocationsKpis>;

/** GET /business/locations: search, filters, sort and numbered pages. */
export const LocationsQuery = z.strictObject({
  /** Name, city or manager. */
  search: z.string().trim().min(1).max(100).optional(),
  status: FirmOfficeStatus.optional(),
  managerUserId: z.uuid().optional(),
  city: z.string().trim().min(1).max(100).optional(),
  sort: z.enum(['name', 'city', 'status', 'createdAt']).optional().default('name'),
  order: z.enum(['asc', 'desc']).optional().default('asc'),
  page: z.coerce.number().int().min(1).max(10_000).optional().default(1),
  limit: z.coerce.number().int().min(1).max(100).optional().default(25),
});
export type LocationsQuery = z.input<typeof LocationsQuery>;

export const LocationList = z.object({
  items: z.array(LocationRow).max(100),
  /** Every location matching the filters. */
  total: z.number().int().nonnegative(),
  kpis: LocationsKpis,
});
export type LocationList = z.infer<typeof LocationList>;

/** GET /business/locations/:id: the profile (and the Edit form's values). */
export const LocationProfile = LocationRow.extend({
  phone: z.string().nullable(),
  alternatePhone: z.string().nullable(),
  email: z.string().nullable(),
  /** The location's own time zone; null means the firm's. */
  timeZone: z.string().nullable(),
  /** The zone its hours and schedules are in: its own, or the firm's. */
  effectiveTimeZone: z.string(),
  notes: z.string().nullable(),
  /** A short-lived link to the photo; null without one. */
  photoUrl: z.string().nullable(),
  hours: z.array(LocationHoursInterval).max(42),
  services: z.array(LocationService).max(100),
  staff: z.array(LocationPerson).max(500),
  /** Future appointments booked there: the screen warns before deactivating (they stay). */
  futureAppointments: z.number().int().nonnegative(),
  createdAt: DateTime,
  /** Send it back as `expectedUpdatedAt` when saving. */
  updatedAt: DateTime,
});
export type LocationProfile = z.infer<typeof LocationProfile>;

/** GET /business/locations/options: what the Add and Edit forms choose from. */
export const LocationOptions = z.object({
  /** Active members who may manage or be assigned to a location. */
  members: z
    .array(
      z.object({
        userId: z.uuid(),
        name: z.string(),
        role: MembershipRole,
        jobTitle: z.string().nullable(),
      }),
    )
    .max(1000),
  /** Services & Pricing's active services (no free text, no "Other"). */
  services: z.array(LocationService).max(500),
  /** The firm's time zone (a location without its own uses it). */
  firmTimeZone: z.string(),
  /** Company Profile's read-only facts on the Edit form. */
  company: z.object({
    legalName: z.string().nullable(),
    businessStructure: z.string().nullable(),
    einLast4: z.string().nullable(),
  }),
  /** The cities of the firm's locations, for the filter. */
  cities: z.array(z.string()).max(500),
  /** Whether the person viewing is a Super Administrator (deactivate, edit or cancel schedules). */
  canManageSchedules: z.boolean(),
});
export type LocationOptions = z.infer<typeof LocationOptions>;

const LocationFields = {
  name: line(100),
  kind: FirmOfficeKind.optional().default('OFFICE'),
  addressLine1: optionalLine(200),
  addressLine2: optionalLine(200),
  city: optionalLine(100),
  state: optionalLine(100),
  postalCode: LocationZip.nullish(),
  phone: LocationPhone,
  alternatePhone: LocationPhone.nullish(),
  email: LocationEmail,
  /** IANA time zone; null or left out means the firm's. */
  timeZone: z.string().trim().min(1).max(64).nullish(),
  notes: text(500, 'many').nullish(),
  /** Services & Pricing services (existing, active). Replaces the set. */
  serviceIds: z.array(z.uuid()).max(100),
  /** The week's open intervals. Replaces the set. */
  hours: LocationHours,
  /** The members who work there (Assigned Staff). Replaces the set. */
  staffUserIds: z.array(z.uuid()).max(500),
};

/** An OFFICE has a street address; a VIRTUAL location has none. */
const addressFits = (
  v: {
    kind?: 'OFFICE' | 'VIRTUAL' | undefined;
    addressLine1?: string | null | undefined;
    addressLine2?: string | null | undefined;
    city?: string | null | undefined;
    state?: string | null | undefined;
    postalCode?: string | null | undefined;
  },
  ctx: z.RefinementCtx,
) => {
  if (v.kind === 'VIRTUAL') {
    for (const key of ['addressLine1', 'addressLine2'] as const) {
      if (v[key])
        ctx.addIssue({
          code: 'custom',
          path: [key],
          message: 'A virtual location has no street address',
        });
    }
    return;
  }
  for (const key of ['addressLine1', 'city', 'state', 'postalCode'] as const) {
    if (!v[key]) ctx.addIssue({ code: 'custom', path: [key], message: 'Required' });
  }
};

const distinct = <T>(items: readonly T[]) => new Set(items).size === items.length;

/** POST /business/locations. 409 DUPLICATE_LOCATION, LOCATION_LIMIT (an ACTIVE one). */
export const CreateLocationRequest = z
  .strictObject({
    ...LocationFields,
    status: FirmOfficeStatus.optional().default('ACTIVE'),
    /** Set as Primary (only an ACTIVE location; the old primary stays, not primary). */
    isMain: z.boolean().optional().default(false),
    /** Assign Location Manager: an active member. */
    managerUserId: z.uuid(),
  })
  .superRefine(addressFits)
  .refine((v) => distinct(v.serviceIds) && distinct(v.staffUserIds), 'No repeats')
  .refine((v) => !v.isMain || v.status === 'ACTIVE', {
    path: ['isMain'],
    message: 'The primary location is active',
  });
export type CreateLocationRequest = z.input<typeof CreateLocationRequest>;

/**
 * PATCH /business/locations/:id: the details (status, primary and manager have their own routes).
 * 409 SAVE_CONFLICT, DUPLICATE_LOCATION.
 */
export const UpdateLocationRequest = z
  .strictObject({
    ...LocationFields,
    expectedUpdatedAt: DateTime,
  })
  .superRefine(addressFits)
  .refine((v) => distinct(v.serviceIds) && distinct(v.staffUserIds), 'No repeats');
export type UpdateLocationRequest = z.input<typeof UpdateLocationRequest>;

/** Now (left out) or later: a time in the future, at most a year ahead. */
const When = z.strictObject({ effectiveAt: DateTime.optional() });

/** POST /business/locations/:id/deactivate (Super Administrator). 409 LOCATION_IS_PRIMARY. */
export const DeactivateLocationRequest = When;
export type DeactivateLocationRequest = z.input<typeof DeactivateLocationRequest>;

/** POST /business/locations/:id/manager: Reassign Manager, now or later. */
export const ReassignManagerRequest = When.extend({ managerUserId: z.uuid() });
export type ReassignManagerRequest = z.input<typeof ReassignManagerRequest>;

/**
 * POST /business/locations/managers/:userId/deactivate (Super Administrator): the manager's firm
 * access ends now or later; their locations get `replacementUserId`, or (null) the main
 * location's manager acts until a new manager takes over. Records stay.
 */
export const DeactivateManagerRequest = When.extend({ replacementUserId: z.uuid().nullable() });
export type DeactivateManagerRequest = z.input<typeof DeactivateManagerRequest>;

/** PUT /business/locations/:id/staff: Manage Staff (replaces the set). */
export const SetLocationStaffRequest = z
  .strictObject({ staffUserIds: z.array(z.uuid()).max(500) })
  .refine((v) => distinct(v.staffUserIds), 'No repeats');
export type SetLocationStaffRequest = z.input<typeof SetLocationStaffRequest>;

/** GET /business/locations/actions. */
export const LocationActionsQuery = z.strictObject({
  status: FirmOfficeActionStatus.optional(),
  locationId: z.uuid().optional(),
  limit: z.coerce.number().int().min(1).max(100).optional().default(50),
});
export type LocationActionsQuery = z.input<typeof LocationActionsQuery>;
export const LocationActionList = z.object({ items: z.array(LocationAction).max(100) });
export type LocationActionList = z.infer<typeof LocationActionList>;

/** PATCH /business/locations/actions/:id (Super Administrator): Edit Schedule, while PENDING. */
export const UpdateLocationActionRequest = z
  .strictObject({
    effectiveAt: DateTime.optional(),
    newManagerUserId: z.uuid().nullable().optional(),
  })
  .refine(
    (v) => v.effectiveAt !== undefined || v.newManagerUserId !== undefined,
    'Nothing to change',
  );
export type UpdateLocationActionRequest = z.input<typeof UpdateLocationActionRequest>;

/** GET /business/locations/activity: Recent Location Activity (this firm's locations only). */
export const LocationActivityQuery = z.strictObject({
  locationId: z.uuid().optional(),
  limit: z.coerce.number().int().min(1).max(50).optional().default(10),
});
export type LocationActivityQuery = z.input<typeof LocationActivityQuery>;
export const LocationActivity = z.object({ items: z.array(AdminActivityItem).max(50) });
export type LocationActivity = z.infer<typeof LocationActivity>;

/** The location photo: JPG, PNG or WebP, at most 5 MB. */
export const LOCATION_PHOTO_LIMITS = {
  maxBytes: 5 * 1024 * 1024,
  types: ['image/jpeg', 'image/png', 'image/webp'],
} as const;
export const CreateLocationPhotoUploadRequest = z.strictObject({
  fileName: line(200),
  contentType: z.enum(LOCATION_PHOTO_LIMITS.types, 'Upload a JPG, PNG or WebP image'),
  sizeBytes: z
    .number()
    .int()
    .min(1, 'The file is empty')
    .max(LOCATION_PHOTO_LIMITS.maxBytes, 'The photo is larger than 5 MB'),
  sha256: z.string().regex(/^[0-9a-f]{64}$/, 'Not a SHA-256'),
});
export type CreateLocationPhotoUploadRequest = z.input<typeof CreateLocationPhotoUploadRequest>;
export const ConfirmLocationPhotoUploadRequest = z.strictObject({
  uploadToken: z.string().min(1).max(8192),
});
export type ConfirmLocationPhotoUploadRequest = z.input<typeof ConfirmLocationPhotoUploadRequest>;
