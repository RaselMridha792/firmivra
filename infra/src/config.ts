/**
 * Settings per environment. Only dev exists today (one AWS account, decided Oct 4);
 * prod is added after the decision with Octavia (docs/SETUP-LOG.md).
 */
export interface EnvConfig {
  envName: 'dev';
  account: string;
  region: string;
  /** Base domain of this environment; sites are admin., app. and portal. under it. */
  domain: string;
  /** Route 53 hosted zone for `domain`, created by hand in Step 5.4. */
  hostedZoneId: string;
  github: { owner: string; repo: string };
  availabilityZones: string[];
  logRetentionDays: 14;
  db: { allocatedStorageGiB: number; maxAllocatedStorageGiB: number; backupDays: number };
  /** Fargate size per service (0.25 vCPU / 0.5 GB), on Spot in dev. */
  task: { cpu: number; memoryMiB: number; spot: boolean };
}

const dev: EnvConfig = {
  envName: 'dev',
  account: '778127141557',
  region: 'us-east-1',
  domain: 'dev.firmivra.com',
  hostedZoneId: 'Z09182951RY8TUAZ5WCXR',
  github: { owner: 'RaselMridha792', repo: 'firmivra' },
  availabilityZones: ['us-east-1a', 'us-east-1b'],
  logRetentionDays: 14,
  db: { allocatedStorageGiB: 20, maxAllocatedStorageGiB: 50, backupDays: 7 },
  task: { cpu: 256, memoryMiB: 512, spot: true },
};

export function configFor(envName: unknown): EnvConfig {
  if (envName === 'dev') return dev;
  throw new Error(
    `Unknown or unsupported environment "${String(envName)}". Use -c env=dev (prod is not set up yet).`,
  );
}

/** firmivra-dev-<name> */
export const resourceName = (config: EnvConfig, name: string) =>
  `firmivra-${config.envName}-${name}`;
