import { runInScope } from './client.js';
import type { IdentityPool, MembershipRole, PrismaClient } from './generated/prisma/client.js';

/**
 * Links people who already exist in Cognito to the database of a dev environment: their `users`
 * rows, `platform_admins` for the Super Admin, and an ACTIVE membership in one firm for staff.
 * Creates that firm (ACTIVE, with empty settings) if it is missing; legal documents and tax
 * statuses come from the firm's setup wizard. Runs as the owner role through the same scopes the
 * app uses (RLS is forced on every table). Safe to run again: rows are upserted, nothing is removed.
 * Run as a one-off ECS task: scripts/link-dev-users.mjs (docs/SETUP-LOG.md, "Link dev users").
 */

export type LinkRole = 'SUPER_ADMIN' | 'OWNER' | 'ADMIN' | 'STAFF';

export interface LinkUser {
  /** Cognito `sub` of the person in the pool that matches the role. */
  sub: string;
  email: string;
  name: string;
  role: LinkRole;
}

export interface LinkFirm {
  slug: string;
  /** Used only when the firm is created. */
  name: string;
  /** Used only when the firm's settings are created. */
  contactEmail?: string;
}

export interface LinkResult {
  businessId: string;
  businessCreated: boolean;
  users: { userId: string; role: LinkRole; created: boolean }[];
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const ROLES: readonly LinkRole[] = ['SUPER_ADMIN', 'OWNER', 'ADMIN', 'STAFF'];

const poolFor = (role: LinkRole): IdentityPool => (role === 'SUPER_ADMIN' ? 'ADMIN' : 'STAFF');

/**
 * Parses and checks the LINK_USERS list. Errors name the entry by position, never by email.
 * A person with a Super Admin login and a staff login is two Cognito users, so two entries.
 */
export function parseLinkUsers(json: string): LinkUser[] {
  let data: unknown;
  try {
    data = JSON.parse(json);
  } catch {
    throw new Error('LINK_USERS is not valid JSON');
  }
  if (!Array.isArray(data) || data.length === 0) {
    throw new Error('LINK_USERS must be a non-empty JSON array');
  }
  const users = data.map((entry: unknown, i): LinkUser => {
    const e = (entry ?? {}) as Record<string, unknown>;
    const at = `LINK_USERS[${i}]`;
    const { sub, email, name, role } = e;
    if (typeof sub !== 'string' || !UUID.test(sub)) throw new Error(`${at}.sub must be a UUID`);
    if (typeof email !== 'string' || !EMAIL.test(email) || email !== email.toLowerCase()) {
      throw new Error(`${at}.email must be a lower-case email address`);
    }
    if (typeof name !== 'string' || name.trim() === '') throw new Error(`${at}.name is empty`);
    if (typeof role !== 'string' || !ROLES.includes(role as LinkRole)) {
      throw new Error(`${at}.role must be one of ${ROLES.join(', ')}`);
    }
    return { sub, email, name: name.trim(), role: role as LinkRole };
  });
  if (new Set(users.map((u) => u.sub)).size !== users.length) {
    throw new Error('LINK_USERS has the same sub twice');
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
        data: { businessId, contactEmail: firm.contactEmail?.toLowerCase() ?? null },
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
