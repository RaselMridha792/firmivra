import { runInScope } from './client.js';
import type { IdentityPool, MembershipRole, PrismaClient } from './generated/prisma/client.js';

/**
 * Links people who already exist in Cognito to the database of a dev environment: their `users`
 * rows, `platform_admins` for the Super Admin, and an ACTIVE membership in one firm for staff.
 * Creates that firm (ACTIVE, with empty settings) if it is missing; contact details, legal
 * documents and tax statuses come from the firm's setup wizard. Runs as the owner role through the
 * same scopes the app uses (RLS is forced on every table). Safe to run again: rows are upserted,
 * nothing is removed. Run as a one-off ECS task: scripts/link-dev-users.mjs (docs/SETUP-LOG.md,
 * "Link dev users").
 *
 * The task input (LINK_USERS) holds only Cognito subs and roles: ECS task overrides are recorded in
 * CloudTrail, so emails and names are read from Cognito inside the task (resolveLinkUsers).
 * A second mode gives one seeded demo client a real login (linkClientAccount, below).
 */

export type LinkRole = 'SUPER_ADMIN' | 'OWNER' | 'ADMIN' | 'STAFF';

/** One LINK_USERS entry: the Cognito `sub` in the pool that matches the role. */
export interface LinkEntry {
  sub: string;
  role: LinkRole;
}

export interface LinkUser extends LinkEntry {
  email: string;
  name: string;
}

/** Email and name of a Cognito user, looked up by `sub` in one pool. */
export type LookupUser = (
  pool: IdentityPool,
  sub: string,
) => Promise<{ email?: string | undefined; name?: string | undefined }>;

export interface LinkFirm {
  slug: string;
  /** Used only when the firm is created. */
  name: string;
}

export interface LinkResult {
  businessId: string;
  businessCreated: boolean;
  users: { userId: string; role: LinkRole; created: boolean }[];
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const ROLES: readonly LinkRole[] = ['SUPER_ADMIN', 'OWNER', 'ADMIN', 'STAFF'];

export const poolFor = (role: LinkRole): IdentityPool =>
  role === 'SUPER_ADMIN' ? 'ADMIN' : 'STAFF';

/**
 * Parses and checks the LINK_USERS list: only `sub` and `role` per entry. Any other key (an email
 * or a name) is refused, so personal data never reaches the task overrides. A person with a Super
 * Admin login and a staff login is two Cognito users, so two entries.
 */
export function parseLinkUsers(json: string): LinkEntry[] {
  let data: unknown;
  try {
    data = JSON.parse(json);
  } catch {
    throw new Error('LINK_USERS is not valid JSON');
  }
  if (!Array.isArray(data) || data.length === 0) {
    throw new Error('LINK_USERS must be a non-empty JSON array');
  }
  const entries = data.map((entry: unknown, i): LinkEntry => {
    const at = `LINK_USERS[${i}]`;
    if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) {
      throw new Error(`${at} must be an object with sub and role`);
    }
    const extra = Object.keys(entry).filter((k) => k !== 'sub' && k !== 'role');
    if (extra.length > 0) {
      throw new Error(`${at} may hold only sub and role, not ${extra.join(', ')}`);
    }
    const { sub, role } = entry as Record<string, unknown>;
    if (typeof sub !== 'string' || !UUID.test(sub)) throw new Error(`${at}.sub must be a UUID`);
    if (typeof role !== 'string' || !ROLES.includes(role as LinkRole)) {
      throw new Error(`${at}.role must be one of ${ROLES.join(', ')}`);
    }
    return { sub, role: role as LinkRole };
  });
  if (new Set(entries.map((e) => e.sub)).size !== entries.length) {
    throw new Error('LINK_USERS has the same sub twice');
  }
  return entries;
}

/**
 * Reads each entry's email and name from Cognito, in the pool that matches its role. Errors name
 * the sub, never the email. The email is stored in lower case (the users table requires it).
 */
export async function resolveLinkUsers(
  entries: LinkEntry[],
  lookup: LookupUser,
): Promise<LinkUser[]> {
  const users: LinkUser[] = [];
  for (const e of entries) {
    const pool = poolFor(e.role);
    const found = await lookup(pool, e.sub);
    const email = found.email?.trim().toLowerCase() ?? '';
    const name = found.name?.trim() ?? '';
    if (!EMAIL.test(email)) throw new Error(`Cognito user ${e.sub} (${pool}) has no valid email`);
    if (name === '') throw new Error(`Cognito user ${e.sub} (${pool}) has no name attribute`);
    users.push({ ...e, email, name });
  }
  return users;
}

export async function linkUsers(
  owner: PrismaClient,
  firm: LinkFirm,
  users: LinkUser[],
): Promise<LinkResult> {
  // Platform scope: the firm, the users and the Super Admin rows, all or nothing.
  const platform = await runInScope(owner, { kind: 'platform' }, async (tx) => {
    let business = await tx.business.findUnique({ where: { slug: firm.slug } });
    const businessCreated = !business;
    if (!business) {
      business = await tx.business.create({
        data: { slug: firm.slug, name: firm.name, status: 'ACTIVE' },
      });
      await tx.auditLog.create({
        data: {
          businessId: business.id,
          action: 'dev.business_created',
          entityType: 'business',
          entityId: business.id,
          metadata: { slug: firm.slug },
        },
      });
    }

    const linked: LinkResult['users'] = [];
    for (const u of users) {
      const pool = poolFor(u.role);
      const existing = await tx.user.findUnique({ where: { cognitoSub: u.sub } });
      if (existing && existing.pool !== pool) {
        throw new Error(
          `User ${existing.id} is in pool ${existing.pool}; role ${u.role} needs pool ${pool}`,
        );
      }
      const user = existing
        ? await tx.user.update({
            where: { id: existing.id },
            data: { email: u.email, name: u.name },
          })
        : await tx.user.create({ data: { cognitoSub: u.sub, pool, email: u.email, name: u.name } });
      if (u.role === 'SUPER_ADMIN') {
        await tx.platformAdmin.upsert({
          where: { userId: user.id },
          update: {},
          create: { userId: user.id, role: 'SUPER_ADMIN' },
        });
      }
      await tx.auditLog.create({
        data: {
          action: 'dev.user_linked',
          entityType: 'user',
          entityId: user.id,
          metadata: { role: u.role, pool, created: !existing },
        },
      });
      linked.push({ userId: user.id, role: u.role, created: !existing });
    }
    return { businessId: business.id, businessCreated, linked };
  });

  // Business scope: the firm's settings and the staff memberships.
  const businessId = platform.businessId;
  await runInScope(owner, { kind: 'business', businessId }, async (tx) => {
    const settings = await tx.businessSettings.findUnique({ where: { businessId } });
    if (!settings) {
      await tx.businessSettings.create({
        data: { businessId },
      });
    }
    for (const l of platform.linked) {
      if (l.role === 'SUPER_ADMIN') continue;
      const role = l.role satisfies MembershipRole;
      const membership = await tx.membership.upsert({
        where: { businessId_userId: { businessId, userId: l.userId } },
        update: { role, status: 'ACTIVE' },
        create: { businessId, userId: l.userId, role, status: 'ACTIVE' },
      });
      await tx.auditLog.create({
        data: {
          businessId,
          action: 'dev.membership_linked',
          entityType: 'membership',
          entityId: membership.id,
          metadata: { userId: l.userId, role },
        },
      });
    }
  });

  return { businessId, businessCreated: platform.businessCreated, users: platform.linked };
}

/**
 * Client mode (LINK_CLIENT_ACCOUNT): gives one seeded demo portal client a real Cognito login. Rasel
 * approved this for the `demo` firm only (Oct 18): its seeded client account, named by email, keeps
 * every row it owns, and its user gets the new clients-pool `sub` instead of the seed's made-up one.
 * The demo seed upserts that user by id and never rewrites `cognito_sub`, so a re-seed keeps the
 * link. The input holds the sub and the seeded account's synthetic `.test` email, never a real one.
 */
export interface LinkClientEntry {
  sub: string;
  firmSlug: string;
  accountEmail: string;
  /**
   * Test Firm B (Rasel, Nov 14): its QA fixture clients have no portal account, so the link
   * creates one for the client with `accountEmail`, for the Cognito login given to
   * linkClientAccount. Set by parseLinkClient for test-firm-b only.
   */
  createForClient?: boolean;
}

/** The Cognito login's own email and name, for an account the link creates. */
export interface LinkClientLogin {
  email: string;
  name: string;
}

export interface LinkClientResult {
  businessId: string;
  clientAccountId: string;
  userId: string;
  changed: boolean;
}

const CLIENT_KEYS = ['sub', 'firmSlug', 'accountEmail'];
/**
 * The firms whose seeded clients may get a real login, and their synthetic email domain (a real
 * client's account never matches): the demo firm's seeded accounts (Oct 18), and Test Firm B's QA
 * fixture clients, whose account the link creates (Nov 14).
 */
const CLIENT_FIRMS: Record<string, { domain: string; create: boolean }> = {
  demo: { domain: '@demo.test', create: false },
  'test-firm-b': { domain: '@example.test', create: true },
};

export function parseLinkClient(json: string): LinkClientEntry {
  let data: unknown;
  try {
    data = JSON.parse(json);
  } catch {
    throw new Error('LINK_CLIENT_ACCOUNT is not valid JSON');
  }
  if (typeof data !== 'object' || data === null || Array.isArray(data)) {
    throw new Error('LINK_CLIENT_ACCOUNT must be an object with sub, firmSlug and accountEmail');
  }
  const extra = Object.keys(data).filter((k) => !CLIENT_KEYS.includes(k));
  if (extra.length > 0) {
    throw new Error(
      `LINK_CLIENT_ACCOUNT may hold only ${CLIENT_KEYS.join(', ')}, not ${extra.join(', ')}`,
    );
  }
  const { sub, firmSlug, accountEmail } = data as Record<string, unknown>;
  if (typeof sub !== 'string' || !UUID.test(sub)) {
    throw new Error('LINK_CLIENT_ACCOUNT.sub must be a UUID');
  }
  const rule = typeof firmSlug === 'string' ? CLIENT_FIRMS[firmSlug] : undefined;
  if (typeof firmSlug !== 'string' || !rule) {
    throw new Error(
      `LINK_CLIENT_ACCOUNT.firmSlug must be one of ${Object.keys(CLIENT_FIRMS).join(', ')}`,
    );
  }
  const email = typeof accountEmail === 'string' ? accountEmail.trim().toLowerCase() : '';
  if (!EMAIL.test(email) || !email.endsWith(rule.domain)) {
    throw new Error(`LINK_CLIENT_ACCOUNT.accountEmail must be a seeded ${rule.domain} address`);
  }
  return { sub, firmSlug, accountEmail: email, ...(rule.create ? { createForClient: true } : {}) };
}

/**
 * Points the firm's one client account with this email at the Cognito user `sub` (clients pool),
 * by setting that account's own user's `cognito_sub`. Refuses when the firm is missing, when 0 or
 * more than 1 accounts match, when the account's user is not a client login, or when the sub
 * already belongs to another user. Safe to run again. Touches no other firm, account or user.
 */
export async function linkClientAccount(
  owner: PrismaClient,
  entry: LinkClientEntry,
  login?: LinkClientLogin,
): Promise<LinkClientResult> {
  const business = await runInScope(owner, { kind: 'platform' }, (tx) =>
    tx.business.findUnique({ where: { slug: entry.firmSlug }, select: { id: true } }),
  );
  if (!business) throw new Error(`Firm ${entry.firmSlug} not found`);
  const businessId = business.id;

  const accounts = await runInScope(owner, { kind: 'business', businessId }, (tx) =>
    tx.clientAccount.findMany({
      where: { businessId, email: entry.accountEmail },
      select: { id: true, userId: true },
    }),
  );
  if (accounts.length === 0 && entry.createForClient) {
    return createClientLogin(owner, businessId, entry, login);
  }
  if (accounts.length !== 1) {
    throw new Error(
      `Firm ${entry.firmSlug} has ${accounts.length} client accounts with that email; expected 1`,
    );
  }
  const account = accounts[0]!;

  const changed = await runInScope(owner, { kind: 'platform' }, async (tx) => {
    const user = await tx.user.findUniqueOrThrow({ where: { id: account.userId } });
    if (user.pool !== 'CLIENT') {
      throw new Error(`User ${user.id} is in pool ${user.pool}; a client login needs pool CLIENT`);
    }
    if (user.cognitoSub === entry.sub) return false;
    const holder = await tx.user.findUnique({ where: { cognitoSub: entry.sub } });
    if (holder) throw new Error(`Cognito user ${entry.sub} is already linked to user ${holder.id}`);
    await tx.user.update({ where: { id: user.id }, data: { cognitoSub: entry.sub } });
    await tx.auditLog.create({
      data: {
        businessId,
        action: 'dev.client_login_linked',
        entityType: 'client_account',
        entityId: account.id,
        metadata: { userId: user.id },
      },
    });
    return true;
  });

  return { businessId, clientAccountId: account.id, userId: account.userId, changed };
}

/**
 * Test Firm B: a portal login for its one seeded client with this email, which has no account
 * yet. The Cognito login's own email and name make the client-pool user and an ACTIVE, approved
 * primary account on that client. Refuses when the client is missing or ambiguous, or when the sub
 * is already linked. Run again, the account exists and the usual link (above) finds it.
 */
async function createClientLogin(
  owner: PrismaClient,
  businessId: string,
  entry: LinkClientEntry,
  login: LinkClientLogin | undefined,
): Promise<LinkClientResult> {
  if (!login) throw new Error("A new client account needs the Cognito login's email and name");
  const clients = await runInScope(owner, { kind: 'business', businessId }, (tx) =>
    tx.client.findMany({
      where: { businessId, email: entry.accountEmail, archivedAt: null },
      select: { id: true, accountType: true },
    }),
  );
  if (clients.length !== 1) {
    throw new Error(
      `Firm ${entry.firmSlug} has ${clients.length} clients with that email; expected 1`,
    );
  }
  const client = clients[0]!;
  const userId = await runInScope(owner, { kind: 'platform' }, async (tx) => {
    const holder = await tx.user.findUnique({ where: { cognitoSub: entry.sub } });
    if (holder) throw new Error(`Cognito user ${entry.sub} is already linked to user ${holder.id}`);
    const user = await tx.user.create({
      data: { cognitoSub: entry.sub, pool: 'CLIENT', email: login.email, name: login.name },
      select: { id: true },
    });
    return user.id;
  });
  const now = new Date();
  const account = await runInScope(owner, { kind: 'business', businessId }, async (tx) => {
    const created = await tx.clientAccount.create({
      data: {
        businessId,
        userId,
        clientId: client.id,
        email: login.email,
        accountType: client.accountType,
        status: 'ACTIVE',
        emailVerifiedAt: now,
        approvedAt: now,
      },
      select: { id: true },
    });
    await tx.auditLog.create({
      data: {
        businessId,
        action: 'dev.client_login_created',
        entityType: 'client_account',
        entityId: created.id,
        metadata: { userId, clientId: client.id },
      },
    });
    return created;
  });
  return { businessId, clientAccountId: account.id, userId, changed: true };
}
