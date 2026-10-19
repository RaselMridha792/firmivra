import { randomBytes } from 'node:crypto';
import {
  CreateSecretCommand,
  DeleteSecretCommand,
  GetSecretValueCommand,
  ResourceNotFoundException,
  SecretsManagerClient,
} from '@aws-sdk/client-secrets-manager';

// Where a platform integration's credentials live (B8: the row keeps `secret_ref`, a reference
// only). Every save writes a new secret under a new name, so the database stamps the rotation
// (it stamps `secret_rotated_at` when the reference changes); the old one is removed after the
// row points at the new one. The reference is what the database accepts: `local:<name>` in
// development and tests (memory, lost on restart: enter the values again), the secret's ARN on
// AWS (SECRETS_MODE=aws; the API role's grant on these names is R1's). Values never leave here
// except to the connection test.

export interface PlatformSecretStore {
  /** Saves the values under a new name for `ownerId`; returns the reference to keep. */
  write(ownerId: string, values: Record<string, string>): Promise<string>;
  /** The values, or null when nothing is stored under the reference any more. */
  read(ref: string): Promise<Record<string, string> | null>;
  /** Deletes the secret (a removal, a rotation's old secret, an environment change). */
  revoke(ref: string): Promise<void>;
}

export const PLATFORM_SECRETS = Symbol('PLATFORM_SECRETS');

const suffix = () => randomBytes(6).toString('hex');
const parse = (text: string | null | undefined): Record<string, string> | null => {
  if (!text) return null;
  try {
    const value = JSON.parse(text) as unknown;
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    return Object.fromEntries(
      Object.entries(value).filter((e): e is [string, string] => typeof e[1] === 'string'),
    );
  } catch {
    return null;
  }
};

/** Development and tests only. */
export class MemoryPlatformSecretStore implements PlatformSecretStore {
  readonly values = new Map<string, string>();
  write(ownerId: string, values: Record<string, string>) {
    const ref = `local:platform.integrations.${ownerId}.${suffix()}`;
    this.values.set(ref, JSON.stringify(values));
    return Promise.resolve(ref);
  }
  read(ref: string) {
    return Promise.resolve(parse(this.values.get(ref)));
  }
  revoke(ref: string) {
    this.values.delete(ref);
    return Promise.resolve();
  }
}

export class AwsPlatformSecretStore implements PlatformSecretStore {
  constructor(private readonly client: SecretsManagerClient) {}

  async write(ownerId: string, values: Record<string, string>): Promise<string> {
    const out = await this.client.send(
      new CreateSecretCommand({
        Name: `firmivra/platform/integrations/${ownerId}/${suffix()}`,
        SecretString: JSON.stringify(values),
      }),
    );
    if (!out.ARN) throw new Error('Secrets Manager returned no ARN');
    return out.ARN;
  }

  async read(ref: string): Promise<Record<string, string> | null> {
    try {
      const out = await this.client.send(new GetSecretValueCommand({ SecretId: ref }));
      return parse(out.SecretString);
    } catch (error) {
      if (error instanceof ResourceNotFoundException) return null;
      throw error;
    }
  }

  async revoke(ref: string): Promise<void> {
    try {
      await this.client.send(new DeleteSecretCommand({ SecretId: ref, RecoveryWindowInDays: 7 }));
    } catch (error) {
      if (!(error instanceof ResourceNotFoundException)) throw error;
    }
  }
}

/** SECRETS_MODE=aws uses Secrets Manager; local (the default outside production) the memory store. */
export function createPlatformSecretStore(
  env: NodeJS.ProcessEnv = process.env,
): PlatformSecretStore {
  const mode = env.SECRETS_MODE ?? (env.NODE_ENV === 'production' ? 'aws' : 'local');
  if (mode === 'aws')
    return new AwsPlatformSecretStore(
      new SecretsManagerClient({ region: env.AWS_REGION ?? 'us-east-1' }),
    );
  if (env.NODE_ENV === 'production')
    throw new Error('SECRETS_MODE=local is not allowed in production');
  return new MemoryPlatformSecretStore();
}
