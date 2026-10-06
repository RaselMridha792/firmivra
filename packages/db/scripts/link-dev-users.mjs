// One-off ECS task (R1 step 13): links people who already exist in Cognito to the dev database.
// Runs with the migrate task definition and these overrides (docs/SETUP-LOG.md, "Link dev users"):
//   command: ["node", "scripts/link-dev-users.mjs"]
//   LINK_USERS: JSON list of { sub, role }; role SUPER_ADMIN, OWNER, ADMIN or STAFF
//   LINK_FIRM_SLUG (default lvp), LINK_FIRM_NAME (only when the firm is created)
// Overrides are recorded in CloudTrail, so they hold no emails or names: the task reads them from
// Cognito (AdminGetUser by sub, the only Cognito permission of the migrate task role).
// Refuses to run unless APP_ENV=dev (set on the dev task only).
// Connection as in migrate-deploy.mjs: owner role, DB_SSLMODE verify-full (default) or disable.
import {
  AdminGetUserCommand,
  CognitoIdentityProviderClient,
} from '@aws-sdk/client-cognito-identity-provider';
import { createPrismaClient } from '../dist/index.js';
import { linkUsers, parseLinkUsers, resolveLinkUsers } from '../dist/link-users.js';

function required(name) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set`);
  return value;
}
const say = (line) => process.stdout.write(`${line}\n`);

if (process.env['APP_ENV'] !== 'dev') {
  throw new Error('link-dev-users runs only where APP_ENV=dev');
}
const sslmode = process.env['DB_SSLMODE'] ?? 'verify-full';
if (sslmode !== 'verify-full' && sslmode !== 'disable') {
  throw new Error(`DB_SSLMODE must be verify-full or disable, not ${sslmode}`);
}
const entries = parseLinkUsers(required('LINK_USERS'));
const firm = {
  slug: process.env['LINK_FIRM_SLUG'] ?? 'lvp',
  name: process.env['LINK_FIRM_NAME'] ?? 'LVP Accounting & Taxes',
};

const pools = {
  STAFF: required('COGNITO_STAFF_USER_POOL_ID'),
  ADMIN: required('COGNITO_ADMINS_USER_POOL_ID'),
};
const cognito = new CognitoIdentityProviderClient({});
/** AdminGetUser accepts the sub in place of the username. */
async function lookup(pool, sub) {
  const out = await cognito
    .send(new AdminGetUserCommand({ UserPoolId: pools[pool], Username: sub }))
    .catch((e) => {
      throw new Error(`Cognito user ${sub} not found in the ${pool} pool (${e.name})`);
    });
  const attr = (name) => out.UserAttributes?.find((a) => a.Name === name)?.Value;
  return { email: attr('email'), name: attr('name') };
}

const users = await resolveLinkUsers(entries, lookup);
const url =
  `postgresql://${encodeURIComponent(required('DB_OWNER_USER'))}:${encodeURIComponent(required('DB_OWNER_PASSWORD'))}` +
  `@${required('DB_HOST')}:${process.env['DB_PORT'] ?? '5432'}/${required('DB_NAME')}?sslmode=${sslmode}`;

const owner = createPrismaClient(url);
try {
  const result = await linkUsers(owner, firm, users);
  say(
    `Firm ${firm.slug}: ${result.businessId}${result.businessCreated ? ' (created, ACTIVE)' : ''}`,
  );
  // User ids and roles only: no emails or names in the task log.
  for (const u of result.users) {
    say(`${u.created ? 'Created' : 'Updated'} user ${u.userId} as ${u.role}`);
  }
  say(`Linked ${result.users.length} user(s)`);
} finally {
  await owner.$disconnect();
}
