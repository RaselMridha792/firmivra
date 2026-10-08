import {
  CreateAliasCommand,
  CreateKeyCommand,
  DescribeKeyCommand,
  type KeyMetadata,
  KMSClient,
} from '@aws-sdk/client-kms';
import { loadFieldEncryptionConfig } from '../field-encryption/config.js';

/**
 * Each firm's own KMS key (CLAUDE.md: per-business KMS keys, the fourth wall), made when approve
 * creates the firm and stored on it (`businesses.kms_key_id`). Field encryption (R10) wraps the
 * firm's data keys with it. Tests inject their own: they never call AWS.
 */
export interface FirmKeys {
  readonly mode: 'local' | 'kms';
  /**
   * The firm's key (its ARN) to store on the business; null with KMS_MODE=local, where field
   * encryption uses LOCAL_KMS_KEY. Safe to repeat: the same firm always gets the same key.
   */
  ensureKey(businessId: string): Promise<string | null>;
}

/** Nest token for the FirmKeys picked by KMS_MODE. */
export const FIRM_KEYS = Symbol('FIRM_KEYS');

export interface FirmKeysConfig {
  mode: 'local' | 'kms';
  /** APP_ENV (`dev`, `prod`): the key's environment tag and alias. Required to make a key. */
  envName: string | null;
}

const ENV_NAME = /^[a-z][a-z0-9-]{0,19}$/;

/** KMS_MODE as field encryption reads it (default kms; local only in development and test). */
export function loadFirmKeysConfig(
  raw: Record<string, string | undefined> = process.env,
): FirmKeysConfig {
  const { mode } = loadFieldEncryptionConfig(raw);
  const envName = raw['APP_ENV'] || null;
  if (envName !== null && !ENV_NAME.test(envName)) {
    throw new Error('Invalid APP_ENV: lower-case letters, digits and hyphens, for example dev');
  }
  return { mode, envName };
}

/** KMS_MODE=local: there is no key to make. */
export class LocalFirmKeys implements FirmKeys {
  readonly mode = 'local' as const;

  ensureKey(): Promise<null> {
    return Promise.resolve(null);
  }
}

/** The purpose tag. IAM lets the API create and use only keys tagged with it (R10, R1). */
export const FIRM_KEY_PURPOSE = 'firm-data';

/** How a firm's key is found again: `alias/firmivra/<env>/business/<businessId>`. */
export const firmKeyAlias = (envName: string, businessId: string) =>
  `alias/firmivra/${envName}/business/${businessId}`;

const errorName = (e: unknown) => (e as { name?: string } | null)?.name;

/**
 * KMS_MODE=kms: one symmetric key per firm, tagged with the purpose, the environment and the
 * firm's id, and named by an alias. A repeat finds the key by its alias instead of making another.
 */
export class AwsFirmKeys implements FirmKeys {
  readonly mode = 'kms' as const;

  constructor(
    private readonly kms: Pick<KMSClient, 'send'>,
    private readonly envName: string | null,
  ) {}

  async ensureKey(businessId: string): Promise<string> {
    // Checked here, not at start-up: an API deployed before its APP_ENV still starts, and approve
    // fails (and can be repeated) until it is set.
    if (!this.envName) throw new Error('APP_ENV must be set to make firm keys (KMS_MODE=kms)');
    const alias = firmKeyAlias(this.envName, businessId);
    const existing = await this.find(alias);
    if (existing) return existing;

    const created = await this.kms.send(
      new CreateKeyCommand({
        Description: `Firmivra ${this.envName}: field encryption for business ${businessId}`,
        KeySpec: 'SYMMETRIC_DEFAULT',
        KeyUsage: 'ENCRYPT_DECRYPT',
        Tags: [
          { TagKey: 'firmivra:purpose', TagValue: FIRM_KEY_PURPOSE },
          { TagKey: 'firmivra:environment', TagValue: this.envName },
          { TagKey: 'firmivra:business-id', TagValue: businessId },
        ],
      }),
    );
    const arn = created.KeyMetadata?.Arn;
    if (!arn) throw new Error('KMS returned no key');
    try {
      await this.kms.send(new CreateAliasCommand({ AliasName: alias, TargetKeyId: arn }));
    } catch (e) {
      // Another approve of the same application named its key a moment earlier: use that one
      // (the key made here stays unused).
      const raced = errorName(e) === 'AlreadyExistsException' ? await this.find(alias) : null;
      if (!raced) throw e;
      return raced;
    }
    return arn;
  }

  /** The key the alias names, or null when there is no such alias. */
  private async find(alias: string): Promise<string | null> {
    let key: KeyMetadata | undefined;
    try {
      key = (await this.kms.send(new DescribeKeyCommand({ KeyId: alias }))).KeyMetadata;
    } catch (e) {
      if (errorName(e) === 'NotFoundException') return null;
      throw e;
    }
    // Disabled or being deleted: a person decides; never a second key behind the same alias.
    if (!key?.Arn || key.KeyState !== 'Enabled') {
      throw new Error(`The key named ${alias} is not enabled`);
    }
    return key.Arn;
  }
}

export function createFirmKeys(config: FirmKeysConfig): FirmKeys {
  return config.mode === 'local'
    ? new LocalFirmKeys()
    : new AwsFirmKeys(new KMSClient({}), config.envName);
}
