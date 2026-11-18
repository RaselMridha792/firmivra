import { z } from 'zod';
import { type ApiRequest, parseInput } from '../client.js';
import { PortalChannelPolicy } from '../db-enums.js';

// Settings > Client Portal > Announcements (Client Portal guide 3; Review One CP-3c, CP-3d, CP-3i).
// Announcements are made in Communications; here the firm decides whether they show in the portal
// at all, whether they show on the client's dashboard, and what clients may do with their email
// and text copies. Owner and Admin; every change is audited. Personal service and account email is
// mandatory and never set here.

/** What clients may do with the text copy: never required, since texts need the client's consent. */
export const PortalSmsPolicy = PortalChannelPolicy.exclude(['REQUIRED']);
export type PortalSmsPolicy = z.infer<typeof PortalSmsPolicy>;

export const PortalAnnouncementSettings = z.object({
  /** CP-3c: the firm's announcements show in the portal; off hides them and deletes none. */
  enabled: z.boolean(),
  /** CP-3i: live announcements on the client's dashboard. */
  onDashboard: z.boolean(),
  /** CP-3d: the email copy: the client's choice, always sent, or never sent. */
  emailPolicy: PortalChannelPolicy,
  /** CP-3d: the text copy: the client's choice (with their consent) or never sent. */
  smsPolicy: PortalSmsPolicy,
  /** The last save, or null while the firm has the defaults. */
  updatedAt: z.iso.datetime({ offset: true }).nullable(),
});
export type PortalAnnouncementSettings = z.infer<typeof PortalAnnouncementSettings>;

/** The defaults, before the firm saves (the table's defaults). */
export const PORTAL_ANNOUNCEMENT_DEFAULTS: Omit<PortalAnnouncementSettings, 'updatedAt'> = {
  enabled: true,
  onDashboard: true,
  emailPolicy: 'CLIENT_CHOICE',
  smsPolicy: 'CLIENT_CHOICE',
};

/** PUT /business/settings/portal-announcements: only the fields sent change. */
export const UpdatePortalAnnouncementSettings = z
  .strictObject({
    enabled: z.boolean().optional(),
    onDashboard: z.boolean().optional(),
    emailPolicy: PortalChannelPolicy.optional(),
    smsPolicy: PortalSmsPolicy.optional(),
  })
  .refine(
    (body) => Object.values(body).some((v) => v !== undefined),
    'Change at least one setting',
  );
export type UpdatePortalAnnouncementSettings = z.input<typeof UpdatePortalAnnouncementSettings>;

const PATH = '/business/settings/portal-announcements';

/** `api.portalAnnouncementSettings`: Owner and Admin read and change the firm's settings. */
export function createPortalAnnouncementSettingsClient(request: ApiRequest) {
  return {
    get: async (): Promise<PortalAnnouncementSettings> => request(PortalAnnouncementSettings, PATH),
    update: async (body: UpdatePortalAnnouncementSettings): Promise<PortalAnnouncementSettings> =>
      request(PortalAnnouncementSettings, PATH, {
        method: 'PUT',
        body: parseInput(UpdatePortalAnnouncementSettings, body),
      }),
  };
}
export type PortalAnnouncementSettingsClient = ReturnType<
  typeof createPortalAnnouncementSettingsClient
>;
