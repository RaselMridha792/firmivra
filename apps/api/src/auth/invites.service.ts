import { createHash, randomBytes, randomUUID } from 'node:crypto';
import {
  ConflictException,
  ForbiddenException,
  GoneException,
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import type { Database, TxClient } from '@firmivra/db';
import {
  type ActivationCheckResponse,
  CreateInviteRequest,
  type MembershipRole,
} from '@firmivra/types';
import { AuditService, type AuditEntity } from '../audit/audit.service.js';
import { type AuthContext, requestContext } from '../common/request-context.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { ENV } from '../config/config.module.js';
import type { Env } from '../config/env.js';
import { DATABASE, OUTSIDE_CALL_LIMITS } from '../database/database.module.js';
import { errorName, Notifier } from '../notifications/notifier.js';
import { ACTIVATION_MAILER, type ActivationMailer } from './activation-mailer.js';
import { runFlow } from './auth-errors.js';
import { IDENTITY_PROVIDER, type IdentityProvider } from './identity/identity-provider.js';

/** Activation links last 7 days (docs/AUTH-DESIGN.md; the database refuses longer). */
const INVITE_DAYS = 7;
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Caps on activation links, counted in the database so every API task shares them (#41 review).
 * They bound email to any one address and the Cognito logins a firm can create.
 */
export const INVITE_LIMITS = {
  /** Links one firm sends in a day, resends included. */
  perFirm: 50,
  /** Links to one person at one firm in a day, resends included. */
  perPerson: 5,
  windowMs: DAY_MS,
};

/** Who sends an invite: a firm owner or admin, or null for the platform (R4, new firm owners). */
export interface Inviter {
  userId: string;
  role: MembershipRole;
}

export interface CreateInviteInput {
  businessId: string;
  email: string;
  /** The name the inviter typed. The invite keeps it, with the email (#52). */
  name: string;
  role: MembershipRole;
  invitedBy: Inviter | null;
  /**
   * R4: a new firm's owner link from Firmivra (role OWNER, invitedBy null). The invite row is
   * written in platform scope, so the database marks it `sent_by_platform` and keeps the
   * Super Admin's token-free copy (`platform_owner_invites`); the membership stays in the firm's.
   */
  fromPlatform?: boolean;
}

export interface InviteResult {
  id: string;
  membershipId: string;
  email: string;
  name: string;
  role: MembershipRole;
  expiresAt: string;
}

/** Who a link goes to, and as what: the details an invite stores and emails. */
interface InviteDetails {
  name: string;
  email: string;
  role: MembershipRole;
}

/**
 * What a new link is for: an invite, with the details the inviter gave, or a resend of a
 * membership's open invite, which takes them from the membership in the invite transaction.
 */
type NewLink =
  ({ kind: 'invite' } & InviteDetails) | { kind: 'resend'; membershipId: string; userId: string };

/**
 * The route's rules for the typed name and email (CreateInviteRequest, which follows the
 * invites CHECKs): callers without the route (R4) get its 400 VALIDATION_FAILED too.
 */
const typedRules = new ZodValidationPipe(CreateInviteRequest.pick({ name: true, email: true }));

/** The name an invite made before #52 gets when its person's user row gives none the rule takes. */
export const UNNAMED_INVITE = 'Invited person';

/**
 * The name for an invite made before #52, which kept none: the person's user row name if the
 * route's rule takes it (CreateInviteRequest.name, stored as the route stores it: trimmed), else
 * their email address under the same rule, else UNNAMED_INVITE. users.name took up to 200
 * characters and any character; whatever this returns passes the rule, and so invites_name.
 */
function legacyName(user: { name: string; email: string }): string {
  for (const candidate of [user.name, user.email]) {
    const parsed = CreateInviteRequest.shape.name.safeParse(candidate);
    if (parsed.success) return parsed.data;
  }
  return UNNAMED_INVITE;
}

const inviteInvalid = () =>
  new NotFoundException({ code: 'INVITE_INVALID', message: 'This link is not valid any more' });
const inviteExpired = () =>
  new GoneException({
    code: 'INVITE_EXPIRED',
    message: 'This link has expired. Ask for a new invite.',
  });
const alreadyMember = () =>
  new ConflictException({
    code: 'ALREADY_MEMBER',
    message: 'This person already works at this firm',
  });
const notInvited = () =>
  new ConflictException({ code: 'NOT_INVITED', message: 'This person has no open invite' });
const accountExists = () =>
  new ConflictException({
    code: 'ACCOUNT_EXISTS',
    message: 'You already have a login: sign in to accept the invite',
  });
const businessInactive = () =>
  new ForbiddenException({ code: 'BUSINESS_INACTIVE', message: 'This firm is not active' });
const tooManyInvites = () =>
  new HttpException(
    { code: 'RATE_LIMITED', message: 'Too many invites today. Try again tomorrow.' },
    HttpStatus.TOO_MANY_REQUESTS,
  );

/** The inviter's role in this transaction (403 once they are no longer an active member). */
async function inviterNow(tx: TxClient, inviter: Inviter): Promise<Inviter> {
  const now = await tx.membership.findFirst({
    where: { userId: inviter.userId, status: 'ACTIVE' },
    select: { role: true },
  });
  if (!now) {
    throw new ForbiddenException({ code: 'FORBIDDEN', message: 'You cannot invite this role' });
  }
  return { userId: inviter.userId, role: now.role };
}

/** The invites_rules trigger refused an acceptance: by the database's clock the link expired. */
const expiredByDatabase = (e: unknown) =>
  e instanceof Error && e.message.includes('expired invite cannot be accepted');

/** The owner invites admins and staff, an admin invites staff; only the platform invites owners. */
function assertMayInvite(inviter: Inviter | null, role: MembershipRole): void {
  if (!inviter) return;
  const allowed: MembershipRole[] =
    inviter.role === 'OWNER' ? ['ADMIN', 'STAFF'] : inviter.role === 'ADMIN' ? ['STAFF'] : [];
  if (!allowed.includes(role)) {
    throw new ForbiddenException({ code: 'FORBIDDEN', message: 'You cannot invite this role' });
  }
}

/**
 * Invites to one person at one firm run one at a time (create, resend, and a deactivation's
 * revoke): each takes this lock first, before any row, so no new lock order appears.
 */
export const lockStaffInvites = (tx: TxClient, businessId: string, userId: string) =>
  tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`staff-invite:${businessId}:${userId}`}, 0))`;

const sha256 = (token: string) => createHash('sha256').update(token).digest('hex');

const isUniqueViolation = (e: unknown) => (e as { code?: string }).code === 'P2002';

/** A membership changed between reading and updating it (for example an activation committed). */
class MembershipChanged extends Error {}

/**
 * Runs `fn`, and once more if another request got there first: it filled a unique index, or
 * changed the membership meanwhile. The second run reads the new state.
 */
async function retryOnConflict<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    if (!isUniqueViolation(e) && !(e instanceof MembershipChanged)) throw e;
    return fn();
  }
}

/**
 * Staff invites and activation (docs/api/auth.yaml). Exported for R4 (a new firm's owner on
 * approval: role OWNER, invitedBy null) and the Team API (resend). See apps/api/README.md.
 */
@Injectable()
export class InvitesService {
  private readonly logger = new Logger(InvitesService.name);

  constructor(
    @Inject(DATABASE) private readonly db: Database,
    @Inject(IDENTITY_PROVIDER) private readonly identity: IdentityProvider,
    @Inject(ACTIVATION_MAILER) private readonly mailer: ActivationMailer,
    private readonly audit: AuditService,
    @Inject(ENV) private readonly env: Env,
    // Absent in R4's own InvitesService (owner-invites.ts), which only creates invites: the
    // link is used through this module's service, which writes the bell item. Without
    // NotificationsModule in the importing module, `staff.joined` is skipped silently.
    @Optional() private readonly notifier?: Notifier,
  ) {}

  /**
   * Invites a person to a firm and emails the activation link. Someone with an open invite gets
   * a new link (the old one stops working); a deactivated member is invited again; an active
   * member is 409 ALREADY_MEMBER. The answer never shows whether the person has a login elsewhere.
   * The firm must be in setup or active (403 BUSINESS_INACTIVE), also for callers without the
   * route's guard (R4, the Team API), and within INVITE_LIMITS (429 RATE_LIMITED). The name and
   * email follow the route's rules for every caller (400 VALIDATION_FAILED), checked before a
   * login is created.
   */
  async createInvite(input: CreateInviteInput): Promise<InviteResult> {
    const { name, email } = typedRules.transform({ name: input.name, email: input.email });
    return this.invite(
      input.businessId,
      input.invitedBy,
      { kind: 'invite', name, email, role: input.role },
      input.fromPlatform,
    );
  }

  /**
   * Makes a link for `link`: createInvite's, or resendInvite's for a membership, made only while
   * that membership is still INVITED (409 NOT_INVITED).
   */
  private async invite(
    businessId: string,
    invitedBy: Inviter | null,
    link: NewLink,
    fromPlatform = false,
  ): Promise<InviteResult> {
    if (link.kind === 'invite') assertMayInvite(invitedBy, link.role);
    if (fromPlatform && invitedBy) throw new Error('A platform invite has no inviting member');

    const firm = this.db.forBusiness(businessId);
    const business = await firm.business.findUnique({
      where: { id: businessId },
      select: { name: true, status: true },
    });
    if (business?.status !== 'PENDING_SETUP' && business?.status !== 'ACTIVE') {
      throw businessInactive();
    }
    const since = new Date(Date.now() - INVITE_LIMITS.windowMs);
    // Before any Cognito login is created, so a firm at its cap cannot fill the pool.
    const sentToday = await firm.invite.count({ where: { createdAt: { gt: since } } });
    if (sentToday >= INVITE_LIMITS.perFirm) throw tooManyInvites();

    // A resend's person is its membership's: never looked up, or created, by email.
    const userId =
      link.kind === 'resend' ? link.userId : await this.staffUserFor(link.email, link.name);

    const token = randomBytes(32).toString('base64url');
    const expiresAt = new Date(Date.now() + INVITE_DAYS * DAY_MS);
    // Retried once if a parallel invite created the membership first (then it is a resend), or
    // an activation or a deactivation changed it meanwhile (then the new state decides).
    // What the inviter typed (#52): the firm sees this, never the person's user row.
    const inviteRow = (membershipId: string, details: InviteDetails) => ({
      businessId,
      membershipId,
      tokenHash: sha256(token),
      name: details.name,
      email: details.email,
      expiresAt,
      invitedByUserId: invitedBy?.userId ?? null,
    });
    const made = await retryOnConflict(() =>
      this.db.withScope(
        { kind: 'business', businessId },
        async (tx) => {
          // One at a time per person, so each revokes the link made by the one before.
          await lockStaffInvites(tx, businessId, userId);
          const existing = await tx.membership.findFirst({
            where: { userId },
            select: { id: true, status: true, role: true },
          });
          let details: InviteDetails;
          if (link.kind === 'resend') {
            // Checked again here (and on the retry): a deactivation or an activation that
            // committed since resendInvite read the membership wins.
            if (existing?.id !== link.membershipId || existing.status !== 'INVITED') {
              throw notInvited();
            }
            // What the membership has now, read under the lock: a re-invite that committed
            // meanwhile (another role, a corrected name) is kept, never written back over.
            details = {
              role: existing.role,
              ...(await this.typedDetails(tx, existing.id, userId)),
            };
          } else {
            details = { name: link.name, email: link.email, role: link.role };
          }
          // The inviter as they are now: one demoted or deactivated a moment ago sends nothing.
          const inviter = invitedBy && (await inviterNow(tx, invitedBy));
          assertMayInvite(inviter, details.role);
          if (existing?.status === 'ACTIVE') throw alreadyMember();
          // Re-inviting changes an existing membership: the inviter must be allowed its role too.
          if (existing) assertMayInvite(inviter, existing.role);
          if (existing) {
            const toThisPerson = await tx.invite.count({
              where: { membershipId: existing.id, createdAt: { gt: since } },
            });
            if (toThisPerson >= INVITE_LIMITS.perPerson) throw tooManyInvites();
          }
          const membership = existing
            ? await this.reinvite(tx, existing, details.role)
            : await tx.membership.create({
                data: { businessId, userId, role: details.role, status: 'INVITED' },
                select: { id: true },
              });
          if (fromPlatform && details.role !== 'OWNER') {
            throw new Error('Only an owner link is sent by the platform');
          }
          // A platform link is written after this commits, in platform scope (below).
          const invite = fromPlatform
            ? null
            : await tx.invite.create({
                data: inviteRow(membership.id, details),
                select: { id: true },
              });
          return {
            inviteId: invite?.id ?? null,
            membershipId: membership.id,
            resent: existing?.status === 'INVITED',
            ...details,
          };
        },
        // Revoking an open link waits for an activation that holds it while it calls Cognito.
        OUTSIDE_CALL_LIMITS,
      ),
    );
    const { membershipId, resent, name, email, role } = made;
    // Platform scope inserts invites but not memberships: the link follows the membership's
    // commit, under the same per-person lock, revoking any link sent in between.
    const inviteId =
      made.inviteId ??
      (await this.db.withScope({ kind: 'platform' }, async (tx) => {
        await lockStaffInvites(tx, businessId, userId);
        await tx.invite.updateMany({
          where: { membershipId, acceptedAt: null, revokedAt: null },
          data: { revokedAt: new Date() },
        });
        const row = await tx.invite.create({
          data: inviteRow(membershipId, made),
          select: { id: true },
        });
        return row.id;
      }));

    // Audited before sending: a failed send still leaves the invite on record.
    await this.auditInFirm(
      businessId,
      undefined,
      'membership.invited',
      { type: 'membership', id: membershipId },
      { inviteId, role, resent },
    );
    await this.mailer.send({
      inviteId,
      businessId,
      to: email,
      name,
      businessName: business.name,
      link: this.activationLink(token),
      expiresAt,
    });
    return {
      id: inviteId,
      membershipId,
      email,
      name,
      role,
      expiresAt: expiresAt.toISOString(),
    };
  }

  /**
   * Back to INVITED with the new role, only if the membership is still as read (status and
   * role): an activation that committed meanwhile is never flipped back (#41 review). Its open
   * links are revoked first: the invite rows, then the membership, the order activation (`use`)
   * and the Team API's deactivate lock them in. In the other order, an activation holding the
   * link and waiting for the membership, and this holding the membership and waiting for the
   * link, deadlock.
   */
  private async reinvite(
    tx: TxClient,
    existing: { id: string; status: string; role: MembershipRole },
    role: MembershipRole,
  ): Promise<{ id: string }> {
    await tx.invite.updateMany({
      where: { membershipId: existing.id, acceptedAt: null, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    const moved = await tx.membership.updateMany({
      where: {
        id: existing.id,
        status: existing.status as 'INVITED' | 'DEACTIVATED',
        role: existing.role,
      },
      data: { status: 'INVITED', role },
    });
    if (moved.count !== 1) throw new MembershipChanged();
    return { id: existing.id };
  }

  /**
   * The staff user with this email, created if needed. Identities are created in platform scope
   * (the users policy), then linked to the firm. The database keeps staff emails unique (#22):
   * when two invites race to create the same person, the second reads the first one's row.
   */
  private async staffUserFor(email: string, name: string): Promise<string> {
    const platform = this.db.forPlatform();
    const find = () =>
      platform.user.findFirst({ where: { email, pool: 'STAFF' }, select: { id: true } });
    const existing = await find();
    if (existing) return existing.id;
    const sub = await this.identity.createUser('STAFF', email);
    try {
      const user = await platform.user.create({
        data: { cognitoSub: sub, pool: 'STAFF', email, name },
        select: { id: true },
      });
      return user.id;
    } catch (e) {
      const raced = isUniqueViolation(e) ? await find() : null;
      if (!raced) throw e;
      // No row points to the Cognito login made for this request: disable it, so it can never
      // be used (the API may not delete Cognito users).
      await this.identity.disableUser('STAFF', sub);
      return raced.id;
    }
  }

  /**
   * A new link for an open invite (Team API), to the name and email typed for it, never the
   * person's user row (staff users are shared across firms: it may hold the name they use at
   * another firm), with the role the membership has. 409 NOT_INVITED unless the membership is
   * INVITED. The membership and those details are read again where the link is made, so a
   * deactivation, an activation or a re-invite that commits first wins.
   */
  async resendInvite(input: {
    businessId: string;
    membershipId: string;
    invitedBy: Inviter | null;
    /** As CreateInviteInput's: a new owner link from Firmivra. */
    fromPlatform?: boolean;
  }): Promise<InviteResult> {
    const membership = await this.db.forBusiness(input.businessId).membership.findUnique({
      where: { id: input.membershipId },
      select: { userId: true, role: true, status: true },
    });
    if (!membership) throw new NotFoundException({ code: 'NOT_FOUND', message: 'Not found' });
    if (membership.status !== 'INVITED') throw notInvited();
    // Checked again on the role the membership has in the invite transaction.
    assertMayInvite(input.invitedBy, membership.role);
    return this.invite(
      input.businessId,
      input.invitedBy,
      { kind: 'resend', membershipId: input.membershipId, userId: membership.userId },
      input.fromPlatform,
    );
  }

  /**
   * The name and email typed for the membership's newest invite. Invites made before #52 have
   * none: then the person's user row, only for what is missing, with a name the route's rule
   * takes (`legacyName`).
   */
  private async typedDetails(
    tx: TxClient,
    membershipId: string,
    userId: string,
  ): Promise<{ name: string; email: string }> {
    const latest = await tx.invite.findFirst({
      where: { membershipId },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      select: { name: true, email: true },
    });
    if (latest?.name && latest.email) return { name: latest.name, email: latest.email };
    const user = await tx.user.findUniqueOrThrow({
      where: { id: userId },
      select: { name: true, email: true },
    });
    return {
      name: latest?.name ?? legacyName(user),
      email: latest?.email ?? user.email,
    };
  }

  /** What the activation screen shows. 404 INVITE_INVALID, 410 INVITE_EXPIRED. */
  async check(token: string): Promise<ActivationCheckResponse> {
    const found = await this.openInvite(token);
    return {
      email: found.user.email,
      name: found.user.name,
      role: found.membership.role,
      business: found.business,
      expiresAt: found.expiresAt.toISOString(),
      hasAccount: await this.identity.hasPassword('STAFF', found.user.cognitoSub),
    };
  }

  /**
   * A new person sets their password and joins the firm. Refused with 409 ACCOUNT_EXISTS when the
   * login already has a password: an invite must never reset an existing account's password.
   * The password is set only while this request holds the link (see `use`), so a link used,
   * resent or revoked a moment earlier can never set it. Returns who to sign in next.
   */
  async activate(token: string, password: string, name?: string) {
    const found = await this.openInvite(token);
    const { user } = found;
    if (await this.identity.hasPassword('STAFF', user.cognitoSub)) throw accountExists();
    await this.use(found, async () => {
      // Checked again now that nobody else can use the link.
      if (await this.identity.hasPassword('STAFF', user.cognitoSub)) throw accountExists();
      await runFlow(() => this.identity.setPassword('STAFF', user.cognitoSub, password));
    });
    if (name && name !== user.name) {
      await this.db.forUser(user.id).user.update({ where: { id: user.id }, data: { name } });
    }
    await this.auditInFirm(
      found.businessId,
      { userId: user.id, cognitoSub: user.cognitoSub, pool: 'STAFF' },
      'membership.activated',
      { type: 'membership', id: found.membership.id },
      { inviteId: found.inviteId, via: 'activate' },
    );
    await this.joined(found.businessId, found.membership.id, user.id);
    return { userId: user.id, sub: user.cognitoSub };
  }

  /** A signed-in person with a login joins the firm they were invited to. 404 for anyone else. */
  async accept(token: string, auth: AuthContext): Promise<void> {
    const found = await this.openInvite(token);
    if (found.user.id !== auth.userId) throw inviteInvalid();
    await this.use(found);
    await this.auditInFirm(
      found.businessId,
      auth,
      'membership.activated',
      { type: 'membership', id: found.membership.id },
      { inviteId: found.inviteId, via: 'accept' },
    );
    await this.joined(found.businessId, found.membership.id, auth.userId);
  }

  /**
   * A new member joined: a bell item for the firm's Owners and Admins, never the joiner (R6,
   * `staff.joined`, the membership's id only). The helper resolves on a database failure;
   * anything else is logged with the id and never fails the join.
   */
  private async joined(businessId: string, membershipId: string, userId: string): Promise<void> {
    if (!this.notifier) return;
    try {
      await this.notifier.notify({
        businessId,
        event: 'staff.joined',
        recordId: membershipId,
        actorUserId: userId,
      });
    } catch (e) {
      this.logger.warn(`staff.joined for membership ${membershipId} not written (${errorName(e)})`);
    }
  }

  private activationLink(token: string): string {
    // The fragment never reaches CloudFront, the load balancer, Next.js logs or a Referer.
    return `${new URL('/activate', this.env.APP_BASE_URL).toString()}#token=${token}`;
  }

  /** The open staff invite for a token, with its membership, person and firm. */
  private async openInvite(token: string) {
    const tokenHash = sha256(token);
    const invite = await this.db.forInvite(tokenHash).invite.findUnique({
      where: { tokenHash },
      select: {
        id: true,
        businessId: true,
        membershipId: true,
        expiresAt: true,
        acceptedAt: true,
        revokedAt: true,
      },
    });
    if (!invite || invite.acceptedAt || invite.revokedAt || !invite.membershipId) {
      throw inviteInvalid();
    }
    if (invite.expiresAt <= new Date()) throw inviteExpired();

    const firm = this.db.forBusiness(invite.businessId);
    const [membership, business] = await Promise.all([
      firm.membership.findUnique({
        where: { id: invite.membershipId },
        select: {
          id: true,
          role: true,
          status: true,
          user: { select: { id: true, email: true, name: true, cognitoSub: true } },
        },
      }),
      firm.business.findUniqueOrThrow({
        where: { id: invite.businessId },
        select: { id: true, slug: true, name: true, status: true },
      }),
    ]);
    if (membership?.status !== 'INVITED') throw inviteInvalid();
    // A suspended or closed firm takes nobody new; a firm in setup does (its owner's invite).
    if (business.status === 'SUSPENDED' || business.status === 'CLOSED') throw inviteInvalid();
    return {
      inviteId: invite.id,
      businessId: invite.businessId,
      expiresAt: invite.expiresAt,
      membership,
      user: membership.user,
      business,
    };
  }

  /**
   * Uses the link, all in one transaction: claims the invite (the conditional update locks its
   * row, so a second activation or a resend waits, then finds it used), makes the membership
   * ACTIVE, then runs `last` (activation sets the Cognito password there, so nothing but the
   * commit follows it). Any failure rolls everything back and the link still works. The
   * database's clock decides expiry: its refusal is 410 INVITE_EXPIRED. With `last` the
   * transaction may run 15 s (OUTSIDE_CALL_LIMITS); accepting calls nothing outside, so it keeps
   * Prisma's 5 s.
   */
  private async use(
    found: { inviteId: string; businessId: string; membership: { id: string } },
    last?: () => Promise<void>,
  ): Promise<void> {
    try {
      await this.db.withScope(
        { kind: 'business', businessId: found.businessId },
        async (tx) => {
          const used = await tx.invite.updateMany({
            where: { id: found.inviteId, acceptedAt: null, revokedAt: null },
            data: { acceptedAt: new Date() },
          });
          if (used.count !== 1) throw inviteInvalid();
          const joined = await tx.membership.updateMany({
            where: { id: found.membership.id, status: 'INVITED' },
            data: { status: 'ACTIVE' },
          });
          if (joined.count !== 1) throw inviteInvalid();
          await last?.();
        },
        last ? OUTSIDE_CALL_LIMITS : undefined,
      );
    } catch (e) {
      if (expiredByDatabase(e)) throw inviteExpired();
      throw e;
    }
  }

  /**
   * Audit rows belong to the firm even on signed-out routes (activation) and platform callers
   * (R4). `actor` replaces the request's signed-in user when the actor is the invitee.
   */
  private auditInFirm(
    businessId: string,
    actor: AuthContext | undefined,
    action: string,
    entity: AuditEntity,
    metadata: Record<string, unknown>,
  ): Promise<void> {
    const store = requestContext.getStore() ?? { requestId: randomUUID() };
    return requestContext.run(
      {
        ...store,
        auth: actor ?? store.auth,
        tenant: { businessId, role: 'STAFF', kind: 'staff' },
      },
      () => this.audit.log(action, entity, metadata),
    );
  }
}
