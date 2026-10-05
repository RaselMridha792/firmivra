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
  github: { owner: string; repo: string };
  availabilityZones: string[];
  logRetentionDays: 14;
  db: { allocatedStorageGiB: number; maxAllocatedStorageGiB: number; backupDays: number };
  /** Fargate size per service (0.25 vCPU / 0.5 GB), on Spot in dev. */
  task: { cpu: number; memoryMiB: number; spot: boolean };
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
  // Switch to the custom domain: customDomain: DEV_FIRMIVRA_COM
  customDomain: undefined,
  github: { owner: 'RaselMridha792', repo: 'firmivra' },
  // AZ ids use1-az1 and use1-az2 (CloudFront VPC origins are not offered in every zone).
  availabilityZones: ['us-east-1a', 'us-east-1b'],
  logRetentionDays: 14,
  db: { allocatedStorageGiB: 20, maxAllocatedStorageGiB: 50, backupDays: 7 },
  task: { cpu: 256, memoryMiB: 512, spot: true },
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
