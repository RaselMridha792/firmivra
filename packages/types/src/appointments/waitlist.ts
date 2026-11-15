import { z } from 'zod';

// R55, Appointments A3 (approved by the lead under Rasel's delegation, Nov 15): the waitlist for an
// earlier time. A client waits for an earlier opening for one of their scheduled appointments.
// When one opens, the firm's job offers it to one entry at a time, by Portal and Email; the client
// takes it or turns it down. What taking it does is the firm's one mode: the appointment moves at
// once (AUTO_CONFIRM, after the time is checked again) or staff approve the move (STAFF_APPROVAL).
// The original time stands until the new one is confirmed. Only the appointment's own client waits.

const DateTime = z.iso.datetime({ offset: true });

/** What a client's request for an offered earlier time does: one mode at a time. */
export const WaitlistMode = z.enum(['AUTO_CONFIRM', 'STAFF_APPROVAL']);
export type WaitlistMode = z.infer<typeof WaitlistMode>;

/** Where an entry is. WAITING, OFFERED and REQUESTED are live; the rest ended it. */
export const WaitlistStatus = z.enum([
  'WAITING',
  'OFFERED',
  'REQUESTED',
  'MOVED',
  'DECLINED',
  'EXPIRED',
  'LEFT',
  'REJECTED',
]);
export type WaitlistStatus = z.infer<typeof WaitlistStatus>;

/** GET/PUT /business/appointment-waitlist/settings (PUT: Owner and Admin). */
export const WaitlistSettings = z.object({
  enabled: z.boolean(),
  mode: WaitlistMode,
});
export type WaitlistSettings = z.infer<typeof WaitlistSettings>;
export const SaveWaitlistSettingsRequest = z.strictObject({
  enabled: z.boolean(),
  mode: WaitlistMode,
});
export type SaveWaitlistSettingsRequest = z.input<typeof SaveWaitlistSettingsRequest>;

/** The earlier time offered to an entry, held for it alone until `expiresAt`. */
export const WaitlistOffer = z.object({
  startsAt: DateTime,
  endsAt: DateTime,
  expiresAt: DateTime,
});
export type WaitlistOffer = z.infer<typeof WaitlistOffer>;

// ---------- Firm ----------

/** One entry as staff see it (GET /business/appointment-waitlist). */
export const WaitlistEntry = z.object({
  id: z.uuid(),
  appointmentId: z.uuid(),
  client: z.object({ id: z.uuid(), name: z.string() }),
  staffName: z.string(),
  typeName: z.string().nullable(),
  /** The appointment's own time, which stands until a move is confirmed. */
  startsAt: DateTime,
  endsAt: DateTime,
  status: WaitlistStatus,
  offer: WaitlistOffer.nullable(),
  requestedAt: DateTime.nullable(),
  decidedAt: DateTime.nullable(),
  createdAt: DateTime,
});
export type WaitlistEntry = z.infer<typeof WaitlistEntry>;

export const WaitlistQuery = z.strictObject({
  /** `live`: waiting, offered or requested (the default); `all` adds the last 30 days' ended ones. */
  show: z.enum(['live', 'all']).default('live'),
});
export type WaitlistQuery = z.input<typeof WaitlistQuery>;

export const WaitlistEntryList = z.object({
  mode: WaitlistMode,
  enabled: z.boolean(),
  items: z.array(WaitlistEntry).max(500),
});
export type WaitlistEntryList = z.infer<typeof WaitlistEntryList>;

// ---------- Portal ----------

/** One of the signed-in client's entries (GET /portal/{slug}/me/appointment-waitlist). */
export const MyWaitlistEntry = z.object({
  id: z.uuid(),
  appointmentId: z.uuid(),
  status: WaitlistStatus,
  offer: WaitlistOffer.nullable(),
  createdAt: DateTime,
});
export type MyWaitlistEntry = z.infer<typeof MyWaitlistEntry>;

export const MyWaitlist = z.object({
  /** The firm's waitlist is on: the client may join it. */
  enabled: z.boolean(),
  /** What taking an offer does. */
  mode: WaitlistMode,
  /** Live entries, and ended ones of the last 30 days. */
  items: z.array(MyWaitlistEntry).max(200),
});
export type MyWaitlist = z.infer<typeof MyWaitlist>;

/** POST /portal/{slug}/me/appointment-waitlist: wait for an earlier time for this appointment. */
export const JoinWaitlistRequest = z.strictObject({ appointmentId: z.uuid() });
export type JoinWaitlistRequest = z.input<typeof JoinWaitlistRequest>;

export const WaitlistEntryId = z.uuid();

/** Stable `error.code` values of the waitlist routes, besides the generic ones. */
export const WaitlistErrorCode = z.enum([
  /** 409: the firm's waitlist is off. */
  'WAITLIST_OFF',
  /** 409: the appointment already waits (one live entry per appointment). */
  'ALREADY_WAITING',
  /** 409: the entry is not where the action needs it (an offer ended, a request decided). */
  'WAITLIST_ENTRY_CLOSED',
  /** 409: the offered time was taken meanwhile; the entry waits again for the next opening. */
  'OFFER_TAKEN',
]);
export type WaitlistErrorCode = z.infer<typeof WaitlistErrorCode>;
