import { createHash, randomBytes, randomUUID } from 'node:crypto';
import {
  ConflictException,
  ForbiddenException,
  GoneException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { Database } from '@firmivra/db';
import type { ActivationCheckResponse, MembershipRole } from '@firmivra/types';
import { AuditService, type AuditEntity } from '../audit/audit.service.js';
import { type AuthContext, requestContext } from '../common/request-context.js';
import { ENV } from '../config/config.module.js';
import type { Env } from '../config/env.js';
import { DATABASE } from '../database/database.module.js';
import { ACTIVATION_MAILER, type ActivationMailer } from './activation-mailer.js';
import { runFlow } from './auth-errors.js';
import { IDENTITY_PROVIDER, type IdentityProvider } from './identity/identity-provider.js';

/** Activation links last 7 days (docs/AUTH-DESIGN.md; the database refuses longer). */
const INVITE_DAYS = 7;
const DAY_MS = 24 * 60 * 60 * 1000;

/** Who sends an invite: a firm owner or admin, or null for the platform (R4, new firm owners). */
export interface Inviter {
  userId: string;
  role: MembershipRole;
}

export interface CreateInviteInput {
  businessId: string;
  email: string;
  name: string;
  role: MembershipRole;
  invitedBy: Inviter | null;
}

export interface InviteResult {
  id: string;
  membershipId: string;
  email: string;
  name: string;
  role: MembershipRole;
  expiresAt: string;
}

const inviteInvalid = () =>
  new NotFoundException({ code: 'INVITE_INVALID', message: 'This link is not valid any more' });
const inviteExpired = () =>
  new GoneException({
    code: 'INVITE_EXPIRED',
    message: 'This link has expired. Ask for a new invite.',
  });

/** The owner invites admins and staff, an admin invites staff; only the platform invites owners. */
function assertMayInvite(inviter: Inviter | null, role: MembershipRole): void {
  if (!inviter) return;
  const allowed: MembershipRole[] =
    inviter.role === 'OWNER' ? ['ADMIN', 'STAFF'] : inviter.role === 'ADMIN' ? ['STAFF'] : [];
  if (!allowed.includes(role)) {
    throw new ForbiddenException({ code: 'FORBIDDEN', message: 'You cannot invite this role' });
  }
}

const sha256 = (token: string) => createHash('sha256').update(token).digest('hex');

const isUniqueViolation = (e: unknown) => (e as { code?: string }).code === 'P2002';

/** Runs `fn`, and once more if it hit a unique index another request filled in meanwhile. */
async function retryOnConflict<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    if (!isUniqueViolation(e)) throw e;
    return fn();
  }
}

/**
 * Staff invites and activation (docs/api/auth.yaml). Exported for R4 (a new firm's owner on
 * approval: role OWNER, invitedBy null) and the Team API (resend). See apps/api/README.md.
 */
@Injectable()
export class InvitesService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    @Inject(IDENTITY_PROVIDER) private readonly identity: IdentityProvider,
    @Inject(ACTIVATION_MAILER) private readonly mailer: ActivationMailer,
    private readonly audit: AuditService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  /**
   * Invites a person to a firm and emails the activation link. Someone with an open invite gets
   * a new link (the old one stops working); a deactivated member is invited again; an active
   * member is 409 ALREADY_MEMBER. The answer never shows whether the person has a login elsewhere.
   */
  async createInvite(input: CreateInviteInput): Promise<InviteResult> {
    const email = input.email.trim().toLowerCase();
    const { businessId, role, invitedBy } = input;
    assertMayInvite(invitedBy, role);

    const userId = await this.staffUserFor(email, input.name);

    const token = randomBytes(32).toString('base64url');
    const expiresAt = new Date(Date.now() + INVITE_DAYS * DAY_MS);
    // Retried once if a parallel invite created the membership first: then it is a resend.
    const { inviteId, membershipId, resent } = await retryOnConflict(() =>
      this.db.withScope({ kind: 'business', businessId }, async (tx) => {
        const existing = await tx.membership.findFirst({
          where: { userId },
          select: { id: true, status: true, role: true },
        });
        if (existing?.status === 'ACTIVE') {
          throw new ConflictException({
            code: 'ALREADY_MEMBER',
            message: 'This person already works at this firm',
          });
        }
        // Re-inviting changes an existing membership: the inviter must be allowed its role too.
        if (existing) assertMayInvite(invitedBy, existing.role);
        const membership = existing
          ? await tx.membership.update({
              where: { id: existing.id },
              data: { status: 'INVITED', role },
              select: { id: true },
            })
          : await tx.membership.create({
              data: { businessId, userId, role, status: 'INVITED' },
              select: { id: true },
            });
        await tx.invite.updateMany({
          where: { membershipId: membership.id, acceptedAt: null, revokedAt: null },
          data: { revokedAt: new Date() },
        });
        const invite = await tx.invite.create({
          data: {
            businessId,
            membershipId: membership.id,
            tokenHash: sha256(token),
            expiresAt,
            invitedByUserId: invitedBy?.userId ?? null,
          },
          select: { id: true },
        });
        return {
          inviteId: invite.id,
          membershipId: membership.id,
          resent: existing?.status === 'INVITED',
        };
      }),
    );

    const business = await this.db
      .forBusiness(businessId)
      .business.findUniqueOrThrow({ where: { id: businessId }, select: { name: true } });
    await this.mailer.send({
      inviteId,
      to: email,
      name: input.name,
      businessName: business.name,
      link: this.activationLink(token),
      expiresAt,
    });
    await this.auditInFirm(
      businessId,
      undefined,
      'membership.invited',
      { type: 'membership', id: membershipId },
      { inviteId, role, resent },
    );
    return {
      id: inviteId,
      membershipId,
      email,
      name: input.name,
      role,
      expiresAt: expiresAt.toISOString(),
    };
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
      // The Cognito login made for this request stays unused (no row points to it).
      return raced.id;
    }
  }

  /** A new link for an open invite (Team API). 409 NOT_INVITED unless the membership is INVITED. */
  async resendInvite(input: {
    businessId: string;
    membershipId: string;
    invitedBy: Inviter | null;
  }): Promise<InviteResult> {
    const membership = await this.db.forBusiness(input.businessId).membership.findUnique({
      where: { id: input.membershipId },
      select: { role: true, status: true, user: { select: { email: true, name: true } } },
    });
    if (!membership) throw new NotFoundException({ code: 'NOT_FOUND', message: 'Not found' });
    if (membership.status !== 'INVITED') {
      throw new ConflictException({
        code: 'NOT_INVITED',
        message: 'This person has no open invite',
      });
    }
    return this.createInvite({
      businessId: input.businessId,
      email: membership.user.email,
      name: membership.user.name,
      role: membership.role,
      invitedBy: input.invitedBy,
    });
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
   * Returns who to sign in next.
   */
  async activate(token: string, password: string, name?: string) {
    const found = await this.openInvite(token);
    const { user } = found;
    if (await this.identity.hasPassword('STAFF', user.cognitoSub)) {
      throw new ConflictException({
        code: 'ACCOUNT_EXISTS',
        message: 'You already have a login: sign in to accept the invite',
      });
    }
    await runFlow(() => this.identity.setPassword('STAFF', user.cognitoSub, password));
    await this.markAccepted(found);
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
    return { userId: user.id, sub: user.cognitoSub };
  }

  /** A signed-in person with a login joins the firm they were invited to. 404 for anyone else. */
  async accept(token: string, auth: AuthContext): Promise<void> {
    const found = await this.openInvite(token);
    if (found.user.id !== auth.userId) throw inviteInvalid();
    await this.markAccepted(found);
    await this.auditInFirm(
      found.businessId,
      auth,
      'membership.activated',
      { type: 'membership', id: found.membership.id },
      { inviteId: found.inviteId, via: 'accept' },
    );
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

  private async markAccepted(found: {
    inviteId: string;
    businessId: string;
    membership: { id: string };
  }) {
    await this.db.withScope({ kind: 'business', businessId: found.businessId }, async (tx) => {
      // Only one request can use a link, even two at once.
      const used = await tx.invite.updateMany({
        where: { id: found.inviteId, acceptedAt: null, revokedAt: null },
        data: { acceptedAt: new Date() },
      });
      if (used.count !== 1) throw inviteInvalid();
      await tx.membership.update({
        where: { id: found.membership.id },
        data: { status: 'ACTIVE' },
      });
    });
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
