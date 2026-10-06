import { z } from 'zod';
import { Email } from '../auth/schemas.js';
import { AccountType, Phone } from '../client-auth/schemas.js';
import { ClientAccountStatus } from '../schemas.js';

// Client records (R10): the firm's clients list and record, the client's profile and their tax
// status per year, plus the client's own My Profile in the portal.
// Firm routes: /api/v1/business/clients/... (Owner, Admin, Staff; archive: Owner and Admin).
// Portal routes: /api/v1/portal/{firmSlug}/me/... (the signed-in client's own record only).
// SSN: only the last 4 digits ever leave the API. Date of birth: in full to the firm's staff and
// to the client themself, never in lists.

const DateTime = z.iso.datetime({ offset: true });
/** A calendar date, YYYY-MM-DD. */
export const CalendarDate = z.iso.date();
const text = (max: number, empty = 'Enter a value') =>
  z.string().trim().min(1, empty).max(max, `Use at most ${max} characters`);

/** A client id in a path: anything else gets 400 VALIDATION_FAILED. */
export const ClientId = z.uuid();
/** A tax year in a path or body. */
export const TaxYear = z.coerce.number().int().min(2000).max(2100);

export const ContactMethod = z.enum(['EMAIL', 'PHONE', 'TEXT']);
export type ContactMethod = z.infer<typeof ContactMethod>;
/** Who a portal login is on the client's record. */
export const PortalRole = z.enum(['PRIMARY', 'SPOUSE', 'AUTHORIZED']);
export type PortalRole = z.infer<typeof PortalRole>;

/** A firm member shown next to a record (assigned to, changed by). */
export const MemberRef = z.strictObject({ userId: z.uuid(), name: z.string() });
export type MemberRef = z.infer<typeof MemberRef>;

export const Address = z.strictObject({
  line1: z.string().nullable(),
  line2: z.string().nullable(),
  city: z.string().nullable(),
  /** Two-letter state code for US addresses. */
  state: z.string().nullable(),
  postalCode: z.string().nullable(),
  country: z.string(),
});
export type Address = z.infer<typeof Address>;

// ---------- The firm's clients ----------
/** One row of the clients list (no profile, SSN or date of birth). */
export const ClientListItem = z.strictObject({
  id: z.uuid(),
  accountType: AccountType,
  displayName: z.string(),
  email: z.string().nullable(),
  phone: z.string().nullable(),
  assignedTo: MemberRef.nullable(),
  /** The primary portal login's status; null when the client has no login. */
  portalStatus: ClientAccountStatus.nullable(),
  archivedAt: DateTime.nullable(),
  createdAt: DateTime,
});
export type ClientListItem = z.infer<typeof ClientListItem>;

/** GET /business/clients. Search matches the name, email and phone. Newest first. */
export const ListClientsQuery = z.strictObject({
  search: z.string().trim().max(100).optional(),
  status: z.enum(['active', 'archived', 'all']).optional().default('active'),
  assignedUserId: z.uuid().optional(),
  /** From the previous page's nextCursor. */
  cursor: z.string().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional().default(25),
});
export type ListClientsQuery = z.input<typeof ListClientsQuery>;

export const ListClientsResponse = z.strictObject({
  items: z.array(ClientListItem).max(100),
  /** Null on the last page. */
  nextCursor: z.string().nullable(),
});
export type ListClientsResponse = z.infer<typeof ListClientsResponse>;

/** The profile as the firm sees it. */
export const ClientProfile = z.strictObject({
  firstName: z.string().nullable(),
  middleName: z.string().nullable(),
  lastName: z.string().nullable(),
  preferredName: z.string().nullable(),
  /** BUSINESS clients: legal name and entity type (LLC, S corp...). */
  businessName: z.string().nullable(),
  entityType: z.string().nullable(),
  dateOfBirth: CalendarDate.nullable(),
  /** The only part of the SSN the API ever returns. */
  ssnLast4: z
    .string()
    .regex(/^\d{4}$/)
    .nullable(),
  address: Address,
  preferredContactMethod: ContactMethod.nullable(),
  referralSource: z.string().nullable(),
  additionalInfo: z.string().nullable(),
  updatedAt: DateTime.nullable(),
});
export type ClientProfile = z.infer<typeof ClientProfile>;

/** GET /business/clients/{id}: the record page (header, overview, contact, profile). */
export const ClientRecord = ClientListItem.extend({
  profile: ClientProfile,
  portalLogins: z.array(
    z.strictObject({
      clientAccountId: z.uuid(),
      email: z.string(),
      portalRole: PortalRole,
      status: ClientAccountStatus,
    }),
  ),
  updatedAt: DateTime,
});
export type ClientRecord = z.infer<typeof ClientRecord>;

const nullable = <S extends z.ZodType>(schema: S) => schema.nullable().optional();
const AddressInput = z.strictObject({
  line1: nullable(text(200)),
  line2: nullable(text(200)),
  city: nullable(text(100)),
  state: nullable(text(50)),
  postalCode: nullable(
    z
      .string()
      .trim()
      .regex(/^[A-Za-z0-9 -]{3,10}$/, 'Enter a valid ZIP code'),
  ),
  country: z
    .string()
    .trim()
    .regex(/^[A-Z]{2}$/, 'Use a two-letter country code')
    .optional(),
});

/**
 * PUT /business/clients/{id}/profile (firm). Send only the fields to change; null clears one.
 * `ssn` (9 digits, dashes allowed) and `dateOfBirth` are stored encrypted and never returned
 * except as ssnLast4 and dateOfBirth.
 */
export const UpdateClientProfileRequest = z.strictObject({
  firstName: nullable(text(100)),
  middleName: nullable(text(100)),
  lastName: nullable(text(100)),
  preferredName: nullable(text(100)),
  businessName: nullable(text(200)),
  entityType: nullable(text(50)),
  dateOfBirth: nullable(CalendarDate),
  ssn: nullable(
    z
      .string()
      .transform((s) => s.replace(/[\s-]/g, ''))
      .pipe(z.string().regex(/^\d{9}$/, 'Enter the 9-digit SSN')),
  ),
  address: AddressInput.optional(),
  preferredContactMethod: nullable(ContactMethod),
  referralSource: nullable(text(200)),
  additionalInfo: nullable(text(2000)),
});
export type UpdateClientProfileRequest = z.input<typeof UpdateClientProfileRequest>;

/** POST /business/clients: a client with no portal login yet. Unknown fields are refused. */
export const CreateClientRequest = z.strictObject({
  accountType: AccountType.optional().default('INDIVIDUAL'),
  displayName: text(200, 'Enter a name'),
  email: Email.optional(),
  phone: Phone.optional(),
  assignedUserId: z.uuid().optional(),
  profile: UpdateClientProfileRequest.optional(),
});
export type CreateClientRequest = z.input<typeof CreateClientRequest>;

/** PATCH /business/clients/{id}. Null clears email, phone or the assigned member. */
export const UpdateClientRequest = z
  .strictObject({
    accountType: AccountType.optional(),
    displayName: text(200, 'Enter a name').optional(),
    email: nullable(Email),
    phone: nullable(Phone),
    assignedUserId: nullable(z.uuid()),
  })
  .refine((body) => Object.keys(body).length > 0, 'Change at least one field');
export type UpdateClientRequest = z.input<typeof UpdateClientRequest>;

// ---------- Tax status per year (firm) ----------
export const TaxStatusRef = z.strictObject({ id: z.uuid(), name: z.string() });

/** One tax year of a client: the firm's status for it and the note the client sees. */
export const ClientTaxYear = z.strictObject({
  taxYear: z.number().int(),
  status: TaxStatusRef,
  /** Shown to the client in the portal. */
  clientNote: z.string().nullable(),
  updatedBy: MemberRef.nullable(),
  updatedAt: DateTime,
});
export type ClientTaxYear = z.infer<typeof ClientTaxYear>;

/** GET /business/clients/{id}/tax-years: newest year first. */
export const ClientTaxYearList = z.strictObject({ items: z.array(ClientTaxYear) });

/** PUT /business/clients/{id}/tax-years/{year}: sets (or first adds) that year's status. */
export const SetClientTaxYearRequest = z.strictObject({
  taxStatusId: z.uuid(),
  clientNote: nullable(text(1000)),
});
export type SetClientTaxYearRequest = z.input<typeof SetClientTaxYearRequest>;

/** GET /business/clients/{id}/tax-years/{year}/history: newest first. */
export const ClientTaxYearHistory = z.strictObject({
  items: z.array(
    z.strictObject({
      status: TaxStatusRef,
      clientNote: z.string().nullable(),
      changedBy: MemberRef.nullable(),
      changedAt: DateTime,
    }),
  ),
});
export type ClientTaxYearHistory = z.infer<typeof ClientTaxYearHistory>;

// ---------- The client's own record (portal) ----------
/** GET /portal/{firmSlug}/me/profile (mockup "My Profile"). Name and date of birth are locked. */
export const MyProfile = z.strictObject({
  fullName: z.string(),
  dateOfBirth: CalendarDate.nullable(),
  /** The login email; changing it is an account (sign-in) change, not a profile edit. */
  email: z.string(),
  phone: z.string().nullable(),
  address: Address,
  preferredContactMethod: ContactMethod.nullable(),
  referralSource: z.string().nullable(),
  additionalInfo: z.string().nullable(),
});
export type MyProfile = z.infer<typeof MyProfile>;

/** PATCH /portal/{firmSlug}/me/profile ("Save Changes"). Name and date of birth are not here. */
export const UpdateMyProfileRequest = z
  .strictObject({
    phone: nullable(Phone),
    address: AddressInput.optional(),
    preferredContactMethod: nullable(ContactMethod),
    referralSource: nullable(text(200)),
    additionalInfo: nullable(text(2000)),
  })
  .refine((body) => Object.keys(body).length > 0, 'Change at least one field');
export type UpdateMyProfileRequest = z.input<typeof UpdateMyProfileRequest>;

/** POST /portal/{firmSlug}/me/profile/name-change: creates a task for the firm's staff. */
export const RequestNameChangeRequest = z.strictObject({
  newName: text(200, 'Enter the new name'),
  reason: nullable(text(500)),
});
export type RequestNameChangeRequest = z.input<typeof RequestNameChangeRequest>;

/** GET /portal/{firmSlug}/me/tax-years: the status name and note per year, newest first. */
export const MyTaxYearList = z.strictObject({
  items: z.array(
    z.strictObject({
      taxYear: z.number().int(),
      status: z.string(),
      clientNote: z.string().nullable(),
      updatedAt: DateTime,
    }),
  ),
});
export type MyTaxYearList = z.infer<typeof MyTaxYearList>;

/** Stable `error.code` values of this module, besides the generic ones in ApiError. */
export const ClientErrorCode = z.enum([
  /** 409: another client of the firm has this email. */
  'DUPLICATE_EMAIL',
  /** 409: the record is archived; restore it first. */
  'CLIENT_ARCHIVED',
  /** 409: the tax status is archived and cannot be assigned. */
  'TAX_STATUS_ARCHIVED',
  /** 409: a name change request is already open. */
  'NAME_CHANGE_PENDING',
]);
export type ClientErrorCode = z.infer<typeof ClientErrorCode>;
