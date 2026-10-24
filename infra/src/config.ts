/**
 * Settings per environment: dev, and prod in the same AWS account (decided Oct 4) with its own
 * firmivra-prod-* stacks (docs/work/R1-cicd.md, "Prod go-live checklist (Oct 22)").
 */
export interface CustomDomain {
  /** Route 53 hosted zone created by hand in Step 5.4; it must be delegated (NS records). */
  zoneName: string;
  hostedZoneId: string;
  /** Host of each site inside the zone. */
  hosts: { admin: string; app: string; portal: string };
}

/**
 * Cognito's own emails (the password reset code) through our SES identity (DEVELOPER mode), from
 * the email stack. Plain names, no cross-stack reference: the auth stack never imports from the
 * email stack's template. Used only with customDomain (the email stack exists only then).
 */
export interface CognitoEmail {
  /** Sender: an address in the verified domain (the API's EMAIL_FROM). */
  from: string;
  /** The email stack's SES domain identity. */
  sesVerifiedDomain: string;
  /** The email stack's configuration set. */
  configurationSet: string;
}

export interface EnvConfig {
  envName: 'dev' | 'prod';
  account: string;
  region: string;
  /**
   * Custom domain for the three sites. Unset: each site uses its free CloudFront default domain
   * (*.cloudfront.net), with no certificate, no DNS records and no SES domain identity.
   * Set it to switch domains; no code changes (docs/SETUP-LOG.md, "Switching to dev.firmivra.com").
   */
  customDomain?: CustomDomain;
  /** Cognito's reset code emails through SES; without customDomain Cognito's default sender. */
  cognitoEmail?: CognitoEmail;
  /**
   * The Secrets Manager secret with the API's Stripe keys (STRIPE_SECRET_KEY,
   * STRIPE_PUBLISHABLE_KEY, STRIPE_WEBHOOK_SECRET), made by hand before the deploy that uses it
   * (docs/SETUP-LOG.md, "Stripe keys"). Unset: the API has no Stripe settings and payments answer
   * 503.
   */
  stripeSecretName?: string;
  /**
   * While the account's SES is in the sandbox, also let the API task role send from any verified
   * identity (not just this env's own), so a later verified address works without a redeploy.
   * Remove once SES production access is granted (docs/SETUP-LOG.md).
   */
  sesSandboxSendFromAnyIdentity?: boolean;
  /**
   * The three distributions' *.cloudfront.net domains, filled in after the first app deploy.
   * Used for the documents bucket CORS while there is no custom domain. Unset: CORS allows
   * https://*.cloudfront.net until the domains are known.
   */
  cloudFrontHosts?: { admin: string; app: string; portal: string };
  /**
   * The repo uses GitHub's immutable OIDC subject (`repo:<owner>@<ownerId>/<repo>@<repoId>:...`),
   * so the deploy role trusts the numeric ids too: a renamed or re-created repo cannot deploy.
   */
  github: { owner: string; ownerId: number; repo: string; repoId: number };
  availabilityZones: string[];
  logRetentionDays: 14;
  db: {
    /** RDS instance class without the db. prefix, for example t3.micro. */
    instanceClass: string;
    allocatedStorageGiB: number;
    maxAllocatedStorageGiB: number;
    backupDays: number;
  };
  /** Fargate size per service (0.25 vCPU / 0.5 GB), on Spot in dev; tasks per service once an image is deployed. */
  task: {
    cpu: number;
    memoryMiB: number;
    spot: boolean;
    /** Tasks per service without auto scaling. */
    count: number;
    /**
     * Application Auto Scaling of the api and web services on their average CPU, between min and
     * max tasks. The services' count is then left to it (a deploy never resets it). Unset: `count`.
     */
    autoScaling?: { min: number; max: number; cpuPercent: number };
  };
  /**
   * The API task's memory: more than the others, as it checks uploads of up to 100 MB and Firm
   * Sign loads whole PDFs (Rasel, Oct 21). 1024 MiB is valid with 0.25 vCPU.
   */
  apiMemoryMiB: number;
  /**
   * The CI stack that owns the account's GitHub OIDC provider, the ECR Public pull-through cache
   * rule and the pull request role, each of which exists once per account: dev's. Another
   * environment's CI stack (prod) imports the provider and uses the same cache.
   */
  ownsAccountCi: boolean;
}

/** dev.firmivra.com, used once GoDaddy delegates the zone to Route 53. */
export const DEV_FIRMIVRA_COM: CustomDomain = {
  zoneName: 'dev.firmivra.com',
  hostedZoneId: 'Z09182951RY8TUAZ5WCXR',
  hosts: {
    admin: 'admin.dev.firmivra.com',
    app: 'app.dev.firmivra.com',
    portal: 'portal.dev.firmivra.com',
  },
};

const dev: EnvConfig = {
  envName: 'dev',
  account: '778127141557',
  region: 'us-east-1',
  // dev.firmivra.com delegated to Route 53 at GoDaddy on Oct 5. Back to *.cloudfront.net: undefined.
  customDomain: DEV_FIRMIVRA_COM,
  // The email stack's names (EmailStack: no-reply@<zone>, the zone, firmivra-dev-email).
  cognitoEmail: {
    from: 'no-reply@dev.firmivra.com',
    sesVerifiedDomain: 'dev.firmivra.com',
    configurationSet: 'firmivra-dev-email',
  },
  stripeSecretName: 'firmivra/dev/stripe',
  sesSandboxSendFromAnyIdentity: true,
  github: { owner: 'RaselMridha792', ownerId: 149437621, repo: 'firmivra', repoId: 1404534844 },
  // AZ ids use1-az1 and use1-az2 (CloudFront VPC origins are not offered in every zone).
  availabilityZones: ['us-east-1a', 'us-east-1b'],
  logRetentionDays: 14,
  // db.t4g.micro is not offered for PostgreSQL in this account (Oct 5); t3.micro is the same size class.
  db: {
    instanceClass: 't3.micro',
    allocatedStorageGiB: 20,
    maxAllocatedStorageGiB: 50,
    // 35 days, the RDS maximum: the Data & Backups page promises a 35-day recovery window (Rasel,
    // Oct 21).
    backupDays: 35,
  },
  task: { cpu: 256, memoryMiB: 512, spot: true, count: 1 },
  apiMemoryMiB: 1024,
  ownsAccountCi: true,
};

/**
 * firmivra.com's Route 53 zone does not exist yet: it is made on Rasel's yes
 * (docs/work/R1-prod-morning.md, section 2), and its id replaces this. Until then prod only
 * synthesizes with `-c allowPending=true` (a read-only check), and nothing can deploy it.
 */
export const PENDING_ZONE_ID = 'PENDING-firmivra-com';

/** Prod (Rasel, Oct 23): the proposals in the prod checklist's step 5, with auto scaling. */
const prod: EnvConfig = {
  envName: 'prod',
  account: dev.account,
  region: dev.region,
  customDomain: {
    zoneName: 'firmivra.com',
    hostedZoneId: PENDING_ZONE_ID,
    hosts: { admin: 'admin.firmivra.com', app: 'app.firmivra.com', portal: 'portal.firmivra.com' },
  },
  cognitoEmail: {
    from: 'no-reply@firmivra.com',
    sesVerifiedDomain: 'firmivra.com',
    configurationSet: 'firmivra-prod-email',
  },
  // Made by hand with the live keys before the first app deploy (checklist step 12).
  stripeSecretName: 'firmivra/prod/stripe',
  // Prod sends only from its own identity; SES production access comes first (step 1).
  sesSandboxSendFromAnyIdentity: false,
  github: dev.github,
  availabilityZones: dev.availabilityZones,
  logRetentionDays: 14,
  db: {
    instanceClass: 't3.small',
    allocatedStorageGiB: 20,
    maxAllocatedStorageGiB: 100,
    // Single-AZ: the data stack fixes multiAz false (Multi-AZ doubles the database cost).
    backupDays: 14,
  },
  // 0.5 vCPU / 1 GB on plain Fargate (no Spot): 2 tasks per service always, up to 6 when the
  // average CPU stays over 55%.
  task: {
    cpu: 512,
    memoryMiB: 1024,
    spot: false,
    count: 2,
    autoScaling: { min: 2, max: 6, cpuPercent: 55 },
  },
  apiMemoryMiB: 1024,
  ownsAccountCi: false,
};

/**
 * Connections one API task can open: pg's default pool of 10 (packages/db createDatabase sets no
 * maximum, and the API makes one database per process). The web tasks never connect.
 */
export const API_DB_POOL_SIZE = 10;

/**
 * About how many connections RDS for PostgreSQL allows per instance class:
 * LEAST(DBInstanceClassMemory / 9531392, 5000), rounded down for the memory RDS keeps for itself
 * (check with `SHOW max_connections` after the first deploy).
 */
export const DB_MAX_CONNECTIONS: Record<string, number> = { 't3.micro': 80, 't3.small': 170 };

/** Kept free for the migrate task, one-off tasks, a psql session and RDS's reserved slots. */
export const DB_CONNECTION_HEADROOM = 30;

/**
 * The most connections the API tasks can hold at once: every task at the scaling maximum, twice
 * over, because a rolling deploy starts the new tasks before it stops the old ones
 * (maxHealthyPercent 200).
 */
export function apiConnectionPeak(config: EnvConfig): number {
  const tasks = config.task.autoScaling?.max ?? config.task.count;
  return tasks * 2 * API_DB_POOL_SIZE;
}

/** Refuses settings whose API tasks could use up the database's connections. */
function checkConnections(config: EnvConfig): EnvConfig {
  const limit = DB_MAX_CONNECTIONS[config.db.instanceClass];
  if (limit === undefined) {
    throw new Error(`Add db.${config.db.instanceClass}'s connection limit to DB_MAX_CONNECTIONS.`);
  }
  const peak = apiConnectionPeak(config);
  if (peak + DB_CONNECTION_HEADROOM > limit) {
    throw new Error(
      `${config.envName}: up to ${peak} API connections plus ${DB_CONNECTION_HEADROOM} kept free ` +
        `exceed db.${config.db.instanceClass}'s about ${limit}. Lower the task maximum or use a ` +
        'larger instance class.',
    );
  }
  return config;
}

/**
 * The settings of `envName`. `allowPending` lets prod synthesize while its zone id is still the
 * placeholder (`cdk synth -c env=prod -c allowPending=true`); no deploy passes it.
 */
export function configFor(
  envName: unknown,
  overrides: Partial<EnvConfig> = {},
  { allowPending = false }: { allowPending?: boolean } = {},
): EnvConfig {
  if (envName === 'dev') return checkConnections({ ...dev, ...overrides });
  if (envName === 'prod') {
    const config = checkConnections({ ...prod, ...overrides });
    if (config.customDomain?.hostedZoneId === PENDING_ZONE_ID && !allowPending) {
      throw new Error(
        "prod has no Route 53 zone id yet (firmivra.com's zone is made on Rasel's yes). For a " +
          'read-only synth add -c allowPending=true.',
      );
    }
    return config;
  }
  throw new Error(`Unknown environment "${String(envName)}". Use -c env=dev or -c env=prod.`);
}

/** firmivra-dev-<name> */
export const resourceName = (config: EnvConfig, name: string) =>
  `firmivra-${config.envName}-${name}`;
