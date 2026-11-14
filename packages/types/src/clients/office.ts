import { z } from 'zod';

// Client Portal guide 2, 7.4 and 9.1 (PRT-1 part 2): the client's local office, the one they chose
// at registration, which an Owner or Admin may change on the client's profile (audited). It drives
// the local office in the client's portal contact card. Never matched from city or state.

/** A location as the profile lists it. */
export const ClientOfficeChoice = z.object({
  id: z.uuid(),
  name: z.string(),
  /** The street lines, then "City, ST 12345"; empty for a virtual office. */
  addressLines: z.array(z.string()),
});
export type ClientOfficeChoice = z.infer<typeof ClientOfficeChoice>;

/** GET /business/clients/{id}/office (Clients VIEW; Staff reach their own clients). */
export const ClientOffice = z.object({
  /** The assigned office; `active` false once that location was deactivated (kept, not shown). */
  office: ClientOfficeChoice.extend({ active: z.boolean() }).nullable(),
  /** The office picked at sign-up, when the client registered online. */
  chosenAtSignUp: z.object({ id: z.uuid(), name: z.string() }).nullable(),
  /** The firm's active locations, primary first: what the office may be changed to. */
  choices: z.array(ClientOfficeChoice).max(200),
  /** Owner and Admin change it. */
  canChange: z.boolean(),
});
export type ClientOffice = z.infer<typeof ClientOffice>;

/**
 * PUT /business/clients/{id}/office (Owner and Admin): one of `choices`, or null for none.
 * 400 OFFICE_NOT_AVAILABLE for any other id.
 */
export const SetClientOfficeRequest = z.strictObject({ officeId: z.uuid().nullable() });
export type SetClientOfficeRequest = z.infer<typeof SetClientOfficeRequest>;
