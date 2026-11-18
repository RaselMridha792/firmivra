import type { Database, TxClient } from '@firmivra/db';
import { PORTAL_ANNOUNCEMENT_DEFAULTS, type PortalAnnouncementSettings } from '@firmivra/types';

// The firm's announcement settings on client_portal_settings (Client Portal Review One CP-3c,
// CP-3d, CP-3i; migration r1_portal_review1): read by the settings routes, the portal's list,
// Communications, the notification preferences and the announcement notice (CP-3d). No row means
// the table's defaults: on, on the dashboard, both channels the client's choice.

export const ANNOUNCEMENT_COLUMNS = {
  announcementsEnabled: true,
  announcementsOnDashboard: true,
  announcementEmailPolicy: true,
  announcementSmsPolicy: true,
  updatedAt: true,
} as const;

type Row = {
  announcementsEnabled: boolean;
  announcementsOnDashboard: boolean;
  announcementEmailPolicy: PortalAnnouncementSettings['emailPolicy'];
  announcementSmsPolicy: string;
  updatedAt: Date;
};

export const announcementView = (row: Row | null): PortalAnnouncementSettings =>
  row
    ? {
        enabled: row.announcementsEnabled,
        onDashboard: row.announcementsOnDashboard,
        emailPolicy: row.announcementEmailPolicy,
        // The database never allows REQUIRED here (CHECK).
        smsPolicy: row.announcementSmsPolicy === 'OFF' ? 'OFF' : 'CLIENT_CHOICE',
        updatedAt: row.updatedAt.toISOString(),
      }
    : { ...PORTAL_ANNOUNCEMENT_DEFAULTS, updatedAt: null };

/** The firm's announcement settings, in the caller's firm transaction. */
export async function announcementSettingsIn(
  tx: TxClient,
  businessId: string,
): Promise<PortalAnnouncementSettings> {
  return announcementView(
    await tx.clientPortalSettings.findUnique({
      where: { businessId },
      select: ANNOUNCEMENT_COLUMNS,
    }),
  );
}

/** The same through the firm's own scope, outside a transaction (the preferences, the sender). */
export async function announcementSettingsOf(
  db: Pick<Database, 'forBusiness'>,
  businessId: string,
): Promise<PortalAnnouncementSettings> {
  return announcementView(
    await db.forBusiness(businessId).clientPortalSettings.findUnique({
      where: { businessId },
      select: ANNOUNCEMENT_COLUMNS,
    }),
  );
}
