import { z } from 'zod';
import { type PoolSecrets, poolSecrets, Sealer } from '../auth/sealed.js';
import type { Env } from '../config/env.js';
import { FIRMIVRA_BRANDING } from '../notify/branding.js';
import type { NotifyTemplates } from '../notify/notify.types.js';

// A team member's invitation (docs/work/R60-team.md, "Team invitations"): a sealed value with no
// table, its 7-day link to the Super Admin site's activation screen, the daily caps and the
// message texts. Nothing here logs: the token and the link never reach a log or an audit row.

const DAY_MS = 86_400_000;
/** A link lasts 7 days, as staff activation links do (contract: "A new 7-day link"). */
export const INVITATION_DAYS = 7;

/**
 * Caps on invitation links, counted from this module's own `platform_member.invited` audit rows
 * under one lock, so every API task shares them (as `INVITE_LIMITS` for staff invites): they bound
 * email and text to any one person and the links the platform sends in a day. Resends count.
 */
export const TEAM_INVITE_LIMITS = {
  /** Links the platform sends in a day. */
  perPlatform: 50,
  /** Links to one person in a day. */
  perPerson: 5,
  windowMs: DAY_MS,
};

/** Who the link goes to. */
export interface InviteChannels {
  email: boolean;
  sms: boolean;
}

/** One more link is over a cap: the platform's for the day, or this person's. */
export const overLimit = (sentToday: { platform: number; person: number }): boolean =>
  sentToday.platform >= TEAM_INVITE_LIMITS.perPlatform ||
  sentToday.person >= TEAM_INVITE_LIMITS.perPerson;

/** When a link made now stops working: 7 days, in whole seconds (the token's expiry is in seconds). */
export const invitationExpiry = (now = Date.now()): Date =>
  new Date(Math.floor((now + INVITATION_DAYS * DAY_MS) / 1000) * 1000);

/** HKDF label for the invitation key. A new label (v2) voids every open invitation. */
export const TEAM_INVITE_LABEL = 'fv-admin-team-invite-v1';

const Sealed = z.object({
  pool: z.literal('ADMIN'),
  userId: z.uuid(),
  /** The member row's `updated_at` when the link was made: a resend or any change voids it. */
  memberUpdatedAt: z.iso.datetime(),
});
type Sealed = z.infer<typeof Sealed>;

/** An opened invitation: whose, the member row's version it was made for, and its expiry. */
export interface OpenedInvitation {
  userId: string;
  memberUpdatedAt: Date;
  expiresAt: Date;
}

/**
 * The invitation token (Rasel, question 3: sealed, no table): JWE with the ADMIN pool's key and
 * this module's own label, holding the user id and the member row's `updated_at`. R2's
 * activation opens it with `open`, then checks it against the member row (`stillValid`) and that
 * the login has no password yet.
 */
export class TeamInvitationTokens {
  private readonly sealer: Sealer<Sealed>;

  constructor(secrets: PoolSecrets) {
    this.sealer = new Sealer(TEAM_INVITE_LABEL, Sealed, secrets);
  }

  /** Holds no state: R2 may build its own from the environment instead of importing the module. */
  static fromEnv(env: Env): TeamInvitationTokens {
    return new TeamInvitationTokens(poolSecrets(env));
  }

  seal(userId: string, memberUpdatedAt: Date, expiresAt: Date): Promise<string> {
    return this.sealer.sealUntil(
      { pool: 'ADMIN', userId, memberUpdatedAt: memberUpdatedAt.toISOString() },
      Math.floor(expiresAt.getTime() / 1000),
    );
  }

  /** The invitation, or undefined when expired, tampered with, sealed for another pool or label. */
  async open(token: string): Promise<OpenedInvitation | undefined> {
    const opened = await this.sealer.open(token, 'ADMIN');
    if (!opened) return undefined;
    return {
      userId: opened.value.userId,
      memberUpdatedAt: new Date(opened.value.memberUpdatedAt),
      expiresAt: new Date(opened.expiresAt * 1000),
    };
  }

  /**
   * The opened invitation still stands for this member row: the same person, still Pending
   * Invitation, and the row not changed since the link was made (a resend touches it).
   */
  static stillValid(
    opened: OpenedInvitation,
    member: { userId: string; status: string; updatedAt: Date },
  ): boolean {
    return (
      opened.userId === member.userId &&
      member.status === 'PENDING_INVITATION' &&
      opened.memberUpdatedAt.getTime() === member.updatedAt.getTime()
    );
  }
}

/**
 * The activation link on the Super Admin site. The token rides in the fragment, which never
 * reaches CloudFront, the load balancer, Next.js logs or a Referer (as the staff link does).
 */
export function invitationLink(adminBaseUrl: string, token: string): string {
  return `${new URL('/activate', adminBaseUrl).toString()}#token=${token}`;
}

/** For example "Tuesday, October 27, 2026 at 9:30 AM EDT", in Firmivra's own time zone. */
function until(expiresAt: Date): string {
  return new Intl.DateTimeFormat('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZone: FIRMIVRA_BRANDING.timeZone,
    timeZoneName: 'short',
  })
    .format(expiresAt)
    .replace(/[\u00a0\u202f]/g, ' ');
}

/**
 * The invitation email, on R6's generic Firmivra email (`platform.message-email`: "Hi {name},"
 * then this text, Firmivra's branding) until R6 adds a `platform.team-invite` template.
 */
export function invitationEmail(
  name: string,
  link: string,
  expiresAt: Date,
): NotifyTemplates['platform.message-email'] {
  return {
    name,
    subject: "You're invited to join the Firmivra team",
    body: [
      'You have been added to the Firmivra team. Open this link to set your password and sign in to the Firmivra admin site:',
      link,
      `The link works until ${until(expiresAt)}. If you did not expect this invitation, you can ignore this email.`,
    ].join('\n\n'),
  };
}

/** The invitation as a text message (`platform.message-sms`, sent as "Firmivra: {body}"). */
export function invitationSms(link: string): NotifyTemplates['platform.message-sms'] {
  return {
    body: `You're invited to the team. Set up your admin account within ${INVITATION_DAYS} days: ${link}`,
  };
}
