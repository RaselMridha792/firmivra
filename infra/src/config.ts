/**
 * Settings per environment. Only dev exists today (one AWS account, decided Oct 4);
 * prod is added after the decision with Octavia (docs/SETUP-LOG.md).
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
  envName: 'dev';
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
  task: { cpu: number; memoryMiB: number; spot: boolean; count: number };
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
  github: { owner: 'RaselMridha792', ownerId: 149437621, repo: 'firmivra', repoId: 1404534844 },
  // AZ ids use1-az1 and use1-az2 (CloudFront VPC origins are not offered in every zone).
  availabilityZones: ['us-east-1a', 'us-east-1b'],
  logRetentionDays: 14,
  // db.t4g.micro is not offered for PostgreSQL in this account (Oct 5); t3.micro is the same size class.
  db: {
    instanceClass: 't3.micro',
    allocatedStorageGiB: 20,
    maxAllocatedStorageGiB: 50,
    backupDays: 7,
  },
  task: { cpu: 256, memoryMiB: 512, spot: true, count: 1 },
};

export function configFor(envName: unknown, overrides: Partial<EnvConfig> = {}): EnvConfig {
  if (envName === 'dev') return { ...dev, ...overrides };
  throw new Error(
    `Unknown or unsupported environment "${String(envName)}". Use -c env=dev (prod is not set up yet).`,
  );
}

/** firmivra-dev-<name> */
export const resourceName = (config: EnvConfig, name: string) =>
  `firmivra-${config.envName}-${name}`;
