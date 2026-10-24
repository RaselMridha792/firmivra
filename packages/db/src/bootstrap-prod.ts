import { runInScope, type createPrismaClient } from './client.js';
import type { IdentityPool } from './generated/prisma/client.js';
import { bootstrapPlatformOrg } from './platform-org.js';

/**
 * The prod bootstrap (Rasel, Oct 24; docs/work/R1-prod-morning.md, section 4): a fresh prod
 * database gets its first Super Admin and the LVP firm. Run once as an ECS task on the prod migrate
 * task definition (scripts/bootstrap-prod.mjs), after Rasel has made the two Cognito users. Later,
 * as their own one-offs: LVP's KMS key (create-firm-key) and set-module.
 *
 * - Super Admin: the admins-pool user's `users` row, its `platform_admins` row (SUPER_ADMIN), the
 *   plan ladder and team catalog and its CEO mapping (as bootstrap-platform-org does on dev), and a
 *   platform audit row.
 * - LVP: the `businesses` row (slug lvp, ACTIVE, the legal name given), empty `business_settings`,
 *   and the Owner's ACTIVE membership from a staff-pool user, with the firm's audit rows.
 *
 * The task input holds only Cognito subs, the legal name and two switches: ECS task overrides are
 * recorded in CloudTrail, so a person's email and name are read from Cognito by sub inside the
 * task (as link-dev-users does), and no email comes from the input. Runs as the owner role through
 * the scopes the app uses (RLS is forced on every table).
 *
 * Runs only with APP_ENV=prod and CONFIRM_PROD_BOOTSTRAP=yes. Once a Super Admin exists, a run with
 * another Super Admin's sub is refused unless ADD_SUPER_ADMIN=yes, which adds that one admin and
 * nothing else. A run with the same input again changes nothing (no new rows, no new audit rows),
 * so a run stopped halfway can be run again to finish.
 */

type Prisma = ReturnType<typeof createPrismaClient>;

export const PROD_FIRM_SLUG = 'lvp';

export interface ProdBootstrapInput {
  /** The Super Admin's sub in the prod admins pool. */
  superAdminSub: string;
  /** Adds this Super Admin when another one already exists; the firm is left alone. */
  addSuperAdmin: boolean;
  /** The firm: only when not adding a Super Admin. */
  firm?: {
    /** The firm's legal name (businesses.legal_name), given when the task runs. */
    legalName: string;
    /** The name shown in the app (businesses.name): the legal name unless given. */
    name: string;
    /** The Owner's sub in the prod staff pool. */
    ownerSub: string;
  };
}

/** Email and name of a Cognito user, looked up by `sub` in one pool. */
export type LookupProdUser = (
  pool: IdentityPool,
  sub: string,
) => Promise<{ email?: string | undefined; name?: string | undefined }>;

export interface ProdBootstrapResult {
  superAdmin: { userId: string; created: boolean };
  firm?: {
    businessId: string;
    businessCreated: boolean;
    owner: { userId: string; membershipId: string; created: boolean };
  };
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
/** The task's settings; any other BOOTSTRAP_* or *_SUB setting is refused, so nothing slips in. */
const KNOWN = [
  'APP_ENV',
  'CONFIRM_PROD_BOOTSTRAP',
  'ADD_SUPER_ADMIN',
  'SUPER_ADMIN_SUB',
  'OWNER_SUB',
  'FIRM_LEGAL_NAME',
  'FIRM_NAME',
];

function firmName(value: string | undefined, setting: string): string {
  const name = (value ?? '').trim();
  if (name === '' || name.length > 200) {
    throw new Error(`${setting} must be 1 to 200 characters`);
  }
  const control = [...name].some((c) => c.charCodeAt(0) < 32 || c.charCodeAt(0) === 127);
  if (name.includes('@') || control) {
    throw new Error(`${setting} must be a name: no email address and no control characters`);
  }
  return name;
}

function sub(value: string | undefined, setting: string): string {
  if (!value || !UUID.test(value)) throw new Error(`${setting} must be a Cognito sub (a UUID)`);
  return value;
}

/**
 * Reads and checks the task's settings. Refuses outside prod, without CONFIRM_PROD_BOOTSTRAP=yes,
 * and any setting it does not know whose name says it is for this task.
 */
export function parseProdBootstrapEnv(env: Record<string, string | undefined>): ProdBootstrapInput {
  if (env['APP_ENV'] !== 'prod') throw new Error('bootstrap-prod runs only where APP_ENV=prod');
  if (env['CONFIRM_PROD_BOOTSTRAP'] !== 'yes') {
    throw new Error('bootstrap-prod needs CONFIRM_PROD_BOOTSTRAP=yes');
  }
  const unknown = Object.keys(env).filter(
    (k) => (k.startsWith('BOOTSTRAP_') || k.endsWith('_SUB')) && !KNOWN.includes(k),
  );
  if (unknown.length > 0) throw new Error(`bootstrap-prod does not take ${unknown.join(', ')}`);
  const addSuperAdmin = env['ADD_SUPER_ADMIN'] === 'yes';
  const superAdminSub = sub(env['SUPER_ADMIN_SUB'], 'SUPER_ADMIN_SUB');
  if (addSuperAdmin) {
    if (env['OWNER_SUB'] || env['FIRM_LEGAL_NAME'] || env['FIRM_NAME']) {
      throw new Error('ADD_SUPER_ADMIN=yes adds one Super Admin only: leave the firm settings out');
    }
    return { superAdminSub, addSuperAdmin };
  }
  const legalName = firmName(env['FIRM_LEGAL_NAME'], 'FIRM_LEGAL_NAME');
  const name = env['FIRM_NAME'] ? firmName(env['FIRM_NAME'], 'FIRM_NAME') : legalName;
  const ownerSub = sub(env['OWNER_SUB'], 'OWNER_SUB');
  if (ownerSub === superAdminSub) throw new Error('OWNER_SUB and SUPER_ADMIN_SUB are one user');
  return { superAdminSub, addSuperAdmin, firm: { legalName, name, ownerSub } };
}

/** A Cognito user's email (lower case) and name; errors name the sub, never the email. */
async function person(lookup: LookupProdUser, pool: IdentityPool, userSub: string) {
  const found = await lookup(pool, userSub);
  const email = found.email?.trim().toLowerCase() ?? '';
  const name = found.name?.trim() ?? '';
  if (!EMAIL.test(email)) throw new Error(`Cognito user ${userSub} (${pool}) has no valid email`);
  if (name === '') throw new Error(`Cognito user ${userSub} (${pool}) has no name attribute`);
  return { email, name };
}

export async function bootstrapProd(
  owner: Prisma,
  input: ProdBootstrapInput,
  lookup: LookupProdUser,
): Promise<ProdBootstrapResult> {
  // Refuse before touching anything: another Super Admin already exists.
  const others = await runInScope(owner, { kind: 'platform' }, (tx) =>
    tx.platformAdmin.count({
      where: { role: 'SUPER_ADMIN', user: { cognitoSub: { not: input.superAdminSub } } },
    }),
  );
  if (others > 0 && !input.addSuperAdmin) {
    throw new Error(
      'A Super Admin already exists: bootstrap-prod has run. To add one more Super Admin, run it ' +
        'with ADD_SUPER_ADMIN=yes and only SUPER_ADMIN_SUB.',
    );
  }

  const admin = await person(lookup, 'ADMIN', input.superAdminSub);
  const ownerPerson = input.firm ? await person(lookup, 'STAFF', input.firm.ownerSub) : null;

  // Platform scope, all or nothing: the users, the Super Admin row and the firm.
  const platform = await runInScope(owner, { kind: 'platform' }, async (tx) => {
    const ensureUser = async (pool: IdentityPool, userSub: string, p: typeof admin) => {
      const existing = await tx.user.findUnique({ where: { cognitoSub: userSub } });
      if (existing && existing.pool !== pool) {
        throw new Error(`User ${existing.id} is in pool ${existing.pool}, not ${pool}`);
      }
      if (existing) return { userId: existing.id, created: false };
      const user = await tx.user.create({
        data: { cognitoSub: userSub, pool, email: p.email, name: p.name },
      });
      return { userId: user.id, created: true };
    };

    const superAdmin = await ensureUser('ADMIN', input.superAdminSub, admin);
    const existingAdmin = await tx.platformAdmin.findUnique({
      where: { userId: superAdmin.userId },
    });
    if (existingAdmin && existingAdmin.role !== 'SUPER_ADMIN') {
      throw new Error(`User ${superAdmin.userId} is a platform admin, but not SUPER_ADMIN`);
    }
    if (!existingAdmin) {
      await tx.platformAdmin.create({ data: { userId: superAdmin.userId, role: 'SUPER_ADMIN' } });
      await tx.auditLog.create({
        data: {
          businessId: null,
          action: 'platform_admin.bootstrapped',
          entityType: 'platform_admin',
          entityId: superAdmin.userId,
          metadata: { from: 'prod-bootstrap', role: 'SUPER_ADMIN', added: input.addSuperAdmin },
        },
      });
    }

    if (!input.firm || !ownerPerson) return { superAdmin, firm: undefined };
    const ownerUser = await ensureUser('STAFF', input.firm.ownerSub, ownerPerson);
    let business = await tx.business.findUnique({ where: { slug: PROD_FIRM_SLUG } });
    const businessCreated = !business;
    if (!business) {
      business = await tx.business.create({
        data: {
          slug: PROD_FIRM_SLUG,
          name: input.firm.name,
          legalName: input.firm.legalName,
          status: 'ACTIVE',
        },
      });
      await tx.auditLog.create({
        data: {
          businessId: business.id,
          action: 'business.bootstrapped',
          entityType: 'business',
          entityId: business.id,
          metadata: { from: 'prod-bootstrap', slug: PROD_FIRM_SLUG, status: 'ACTIVE' },
        },
      });
    }
    return {
      superAdmin,
      firm: { businessId: business.id, businessCreated, ownerUserId: ownerUser.userId },
    };
  });

  // The plan ladder, the team catalog and every Super Admin's CEO mapping (admin scope).
  await bootstrapPlatformOrg(owner, 'prod-bootstrap');

  if (!platform.firm) return { superAdmin: platform.superAdmin };

  // Business scope: the firm's empty settings and the Owner's membership.
  const { businessId, businessCreated, ownerUserId } = platform.firm;
  const ownerRow = await runInScope(owner, { kind: 'business', businessId }, async (tx) => {
    if (!(await tx.businessSettings.findUnique({ where: { businessId } }))) {
      await tx.businessSettings.create({ data: { businessId } });
    }
    const existing = await tx.membership.findUnique({
      where: { businessId_userId: { businessId, userId: ownerUserId } },
    });
    if (existing) {
      if (existing.role !== 'OWNER' || existing.status !== 'ACTIVE') {
        throw new Error(`Membership ${existing.id} exists but is not an active Owner`);
      }
      return { membershipId: existing.id, created: false };
    }
    const membership = await tx.membership.create({
      data: { businessId, userId: ownerUserId, role: 'OWNER', status: 'ACTIVE' },
    });
    await tx.auditLog.create({
      data: {
        businessId,
        action: 'membership.bootstrapped',
        entityType: 'membership',
        entityId: membership.id,
        metadata: { from: 'prod-bootstrap', userId: ownerUserId, role: 'OWNER' },
      },
    });
    return { membershipId: membership.id, created: true };
  });

  return {
    superAdmin: platform.superAdmin,
    firm: {
      businessId,
      businessCreated,
      owner: { userId: ownerUserId, ...ownerRow },
    },
  };
}
