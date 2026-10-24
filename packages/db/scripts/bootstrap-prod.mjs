// One-off ECS task (Rasel, Oct 24; docs/work/R1-prod-morning.md, section 4): the first prod Super
// Admin and the LVP firm. Runs once on the prod migrate task definition, after Rasel has made the
// two Cognito users (the Super Admin in the prod admins pool, LVP's Owner in the prod staff pool),
// with these overrides:
//   command: ["node", "scripts/bootstrap-prod.mjs"]
//   CONFIRM_PROD_BOOTSTRAP: yes
//   SUPER_ADMIN_SUB, OWNER_SUB: the two users' Cognito subs
//   FIRM_LEGAL_NAME: LVP's legal name, given by Rasel when the task runs (FIRM_NAME: the name the
//   app shows, if not the legal name)
// To add one more Super Admin later: ADD_SUPER_ADMIN=yes with only SUPER_ADMIN_SUB.
// Overrides are recorded in CloudTrail, so they hold no emails: the task reads each person's email
// and name from Cognito (ListUsers with the filter sub = "<sub>", as link-dev-users does).
// Refuses to run unless APP_ENV=prod (set on the prod task definition only). The firm's KMS key
// (create-firm-key) and set-module are separate one-offs, after this.
// Connection as in migrate-deploy.mjs: owner role, DB_SSLMODE verify-full (default) or disable.
import {
  CognitoIdentityProviderClient,
  ListUsersCommand,
} from '@aws-sdk/client-cognito-identity-provider';
import { bootstrapProd, parseProdBootstrapEnv } from '../dist/bootstrap-prod.js';
import { createPrismaClient } from '../dist/index.js';

function required(name) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set`);
  return value;
}
const say = (line) => process.stdout.write(`${line}\n`);

// APP_ENV=prod, CONFIRM_PROD_BOOTSTRAP=yes and the subs are checked before anything else.
const input = parseProdBootstrapEnv(process.env);
const sslmode = process.env['DB_SSLMODE'] ?? 'verify-full';
if (sslmode !== 'verify-full' && sslmode !== 'disable') {
  throw new Error(`DB_SSLMODE must be verify-full or disable, not ${sslmode}`);
}

const pools = {
  STAFF: required('COGNITO_STAFF_USER_POOL_ID'),
  ADMIN: required('COGNITO_ADMINS_USER_POOL_ID'),
};
const cognito = new CognitoIdentityProviderClient({});
async function lookup(pool, sub) {
  const out = await cognito.send(
    new ListUsersCommand({ UserPoolId: pools[pool], Filter: `sub = "${sub}"`, Limit: 2 }),
  );
  const found = out.Users ?? [];
  if (found.length !== 1) {
    throw new Error(`Cognito user ${sub} not found in the ${pool} pool (${found.length} matches)`);
  }
  const attr = (name) => found[0].Attributes?.find((a) => a.Name === name)?.Value;
  return { email: attr('email'), name: attr('name') };
}

const url =
  `postgresql://${encodeURIComponent(required('DB_OWNER_USER'))}:${encodeURIComponent(required('DB_OWNER_PASSWORD'))}` +
  `@${required('DB_HOST')}:${process.env['DB_PORT'] ?? '5432'}/${required('DB_NAME')}?sslmode=${sslmode}`;

const owner = createPrismaClient(url);
try {
  const result = await bootstrapProd(owner, input, lookup);
  // Ids only: no emails or names in the task log.
  const a = result.superAdmin;
  say(`Super Admin ${a.userId}: ${a.created ? 'created' : 'already there'}, mapped to CEO`);
  if (result.firm) {
    const f = result.firm;
    say(`Firm lvp ${f.businessId}: ${f.businessCreated ? 'created, ACTIVE' : 'already there'}`);
    say(
      `Owner ${f.owner.userId}, membership ${f.owner.membershipId}: ` +
        `${f.owner.created ? 'created' : 'already there'}`,
    );
    say('Next: create-firm-key lvp (and --check), then set-module, each its own one-off');
  }
} finally {
  await owner.$disconnect();
}
