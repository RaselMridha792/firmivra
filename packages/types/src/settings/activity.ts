import { z } from 'zod';

const DateTime = z.iso.datetime({ offset: true });

/** The icon and colour of an activity row. */
export const AdminActivityTone = z.enum(['success', 'warning', 'info', 'user', 'system']);
export type AdminActivityTone = z.infer<typeof AdminActivityTone>;

/** One Recent Administrative (or Location) Activity row, from the firm's audit log. */
export const AdminActivityItem = z.object({
  id: z.uuid(),
  at: DateTime,
  /** The audit action, for example "settings.branding_updated". */
  action: z.string(),
  /** The screen's words: "Branding settings updated", "New staff user added - T. Williams". */
  label: z.string(),
  tone: AdminActivityTone,
});
export type AdminActivityItem = z.infer<typeof AdminActivityItem>;
