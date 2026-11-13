import { z } from 'zod';
import { PortalContact } from '../client-auth/schemas.js';
import { type ApiRequest, parseInput } from '../client.js';

// Client Portal guide 4 and 9.4 (PRT-3, R1's `client_portal_settings`): what the portal's contact
// card shows. The firm switches the corporate office and the client's local office on and off and
// chooses the contact methods; the details always come from Company Profile and Locations, never
// from a copy here.

const DateTime = z.iso.datetime({ offset: true });

/** The seven switches. A firm that never saved has the defaults (texts and appointments off). */
export const PortalContactSwitches = z.object({
  showCorporateOffice: z.boolean(),
  showLocalOffice: z.boolean(),
  allowPhone: z.boolean(),
  /** Texts still only to a client who agreed to them. */
  allowSms: z.boolean(),
  allowEmail: z.boolean(),
  allowSecureMessage: z.boolean(),
  allowAppointmentLink: z.boolean(),
});
export type PortalContactSwitches = z.infer<typeof PortalContactSwitches>;

/** One office as the portal shows it: its name and its profile's contact details. */
export const PortalOfficeContact = PortalContact.extend({
  /** The location's id; null for the corporate office from Company Profile. */
  id: z.uuid().nullable(),
  name: z.string(),
});
export type PortalOfficeContact = z.infer<typeof PortalOfficeContact>;

/**
 * GET /business/settings/portal-contact (Owner and Admin): the switches, and what the preview
 * shows: the corporate office (Company Profile, filled from the main location) and the firm's
 * active locations, primary first.
 */
export const PortalContactSettings = z.object({
  switches: PortalContactSwitches,
  /** Null while the firm has never saved (the defaults apply). */
  updatedAt: DateTime.nullable(),
  corporate: PortalOfficeContact.nullable(),
  offices: z.array(PortalOfficeContact).max(200),
});
export type PortalContactSettings = z.infer<typeof PortalContactSettings>;

/** PUT /business/settings/portal-contact: only the switches sent change. */
export const UpdatePortalContactRequest = PortalContactSwitches.partial()
  .strict()
  .refine((body) => Object.keys(body).length > 0, 'Change at least one setting');
export type UpdatePortalContactRequest = z.infer<typeof UpdatePortalContactRequest>;

/**
 * GET /portal/{firmSlug}/me/contact: the signed-in client's contact card. The corporate office
 * and their local office (the one assigned on their client record) when the firm shows them, and
 * the ways the firm lets them get in touch.
 */
export const MyPortalContact = z.object({
  corporate: PortalOfficeContact.nullable(),
  /** Null when hidden, when no office is assigned, or when the office is no longer active. */
  local: PortalOfficeContact.nullable(),
  methods: z.object({
    phone: z.boolean(),
    /** Only when the firm allows texts and the client agreed to them. */
    sms: z.boolean(),
    email: z.boolean(),
    /** Only while Messages is on in the portal too. */
    secureMessage: z.boolean(),
    appointment: z.boolean(),
  }),
});
export type MyPortalContact = z.infer<typeof MyPortalContact>;

const FIRM = '/business/settings/portal-contact';

/**
 * `api.portalContact` (apps/web/src/lib/api.ts). Owner and Admin read and change the switches
 * (audited); a signed-in client reads their own card (`mine`).
 */
export function createPortalContactClient(request: ApiRequest) {
  return {
    get: async (): Promise<PortalContactSettings> => request(PortalContactSettings, FIRM),
    update: async (body: UpdatePortalContactRequest): Promise<PortalContactSettings> =>
      request(PortalContactSettings, FIRM, {
        method: 'PUT',
        body: parseInput(UpdatePortalContactRequest, body),
      }),
    mine: async (firmSlug: string): Promise<MyPortalContact> =>
      request(MyPortalContact, `/portal/${encodeURIComponent(firmSlug)}/me/contact`),
  };
}
export type PortalContactClient = ReturnType<typeof createPortalContactClient>;
