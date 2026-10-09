import type { Logger } from '@nestjs/common';
import {
  CreateAliasCommand,
  CreateKeyCommand,
  DescribeKeyCommand,
  GetKeyPolicyCommand,
  type KeyMetadata,
  KMSClient,
  ListGrantsCommand,
  ListResourceTagsCommand,
  type Tag,
} from '@aws-sdk/client-kms';
import { loadFieldEncryptionConfig } from '../field-encryption/config.js';

/**
 * Each firm's own KMS key (CLAUDE.md: per-business KMS keys, the fourth wall), made when approve
 * creates the firm (R4 step 3) or by the one-off create-firm-key command, and stored on the firm
 * (`businesses.kms_key_id`). Field encryption (R10) wraps the firm's data keys with it. Tests
 * inject their own KMS: they never call AWS.
 */
export interface FirmKeys {
  readonly mode: 'local' | 'kms';
  /**
   * The firm's key (its ARN) to store on the business; null with KMS_MODE=local, where field
   * encryption uses LOCAL_KMS_KEY. Safe to repeat: the same firm always gets the same key.
   */
  ensureKey(businessId: string): Promise<string | null>;
}

/** Nest token for the FirmKeys picked by KMS_MODE (approve registers it). */
export const FIRM_KEYS = Symbol('FIRM_KEYS');

export interface FirmKeysConfig {
  mode: 'local' | 'kms';
  /** APP_ENV (`dev`, `prod`): the key's env tag and alias. Required to make a key. */
  envName: string | null;
}

const ENV_NAME = /^[a-z][a-z0-9-]{0,19}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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

/**
 * The tags IAM checks (infra/src/firm-key-policy.ts uses the same names). The API role may make
 * a key only with these, may use a key only when its env and purpose tags match and the
 * encryption context's businessId equals its businessId tag, and can never change a firm tag to
 * another value.
 */
export const FIRM_KEY_TAGS = {
  env: 'firmivra:env',
  businessId: 'firmivra:businessId',
  purpose: 'firmivra:purpose',
} as const;
export const FIRM_KEY_PURPOSE = 'firm-data';

/** How a firm's key is found again: `alias/firmivra/<env>/business/<businessId>`. */
export const firmKeyAlias = (envName: string, businessId: string) =>
  `alias/firmivra/${envName}/business/${businessId}`;

/**
 * A person decides: a key was made but could not be named (it holds no data, and a person
 * schedules its deletion), or the key an alias names is not one this adapter would make.
 */
export class FirmKeyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FirmKeyError';
  }
}

/** The AWS error's name (AccessDeniedException), never its message (it holds ARNs). */
export function awsErrorName(error: unknown): string {
  const name = (error as { name?: unknown } | null | undefined)?.name;
  return typeof name === 'string' && /^[A-Za-z][A-Za-z0-9]{0,99}$/.test(name)
    ? name
    : 'UnknownError';
}

/**
 * Errors KMS can answer right after CreateKey: tags take up to five minutes to reach
 * authorization (CreateAlias needs the env tag), and a new key may not be found yet.
 */
const NOT_READY = new Set([
  'AccessDeniedException',
  'NotFoundException',
  'KMSInvalidStateException',
]);

export interface AwsFirmKeysOptions {
  /** Ids, key ARNs and alias names only. */
  logger?: Pick<Logger, 'log'>;
  /** How long to keep trying to name a new key (default five minutes). */
  aliasWaitMs?: number;
  sleep?: (ms: number) => Promise<void>;
}

const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * KMS_MODE=kms: one symmetric key per firm, tagged with its env, its firm's id and the purpose,
 * and named by an alias. A repeat finds the key by its alias instead of making another.
 *
 * Key policy: CreateKey sends none, so KMS attaches its default policy for keys made through the
 * API, exactly one statement:
 *   {"Sid":"Enable IAM User Permissions","Effect":"Allow",
 *    "Principal":{"AWS":"arn:aws:iam::<account>:root"},"Action":"kms:*","Resource":"*"}
 * It hands control of the key to IAM in our account, so for a key this adapter made, the API
 * role's IAM statements are all the API can do with it (no deletion, no disabling, no policy or
 * tag changes). Sending that document ourselves would need kms:PutKeyPolicy or
 * BypassPolicyLockoutSafetyCheck, which the role is refused.
 *
 * IAM cannot check CreateKey's Policy parameter (KMS has no condition key for it), and an alias
 * can name any firm key of the env. So every key the adapter adopts by its alias (a repeat, or
 * the key another call named first) must look exactly like one it makes: enabled, a customer key
 * of this account, KMS key material, one Region, symmetric encryption, exactly the three firm
 * tags of this business, KMS's default key policy and no grants. Anything else is a
 * FirmKeyError: a person decides, and nothing is stored.
 */
export class AwsFirmKeys implements FirmKeys {
  readonly mode = 'kms' as const;
  private readonly logger: Pick<Logger, 'log'> | undefined;
  private readonly aliasWaitMs: number;
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(
    private readonly kms: Pick<KMSClient, 'send'>,
    private readonly envName: string | null,
    options: AwsFirmKeysOptions = {},
  ) {
    this.logger = options.logger;
    this.aliasWaitMs = options.aliasWaitMs ?? 300_000;
    this.sleep = options.sleep ?? wait;
  }

  async ensureKey(businessId: string): Promise<string> {
    // Checked here, not at start-up: an API deployed before its APP_ENV still starts, and making
    // a key fails (and can be repeated) until it is set.
    if (!this.envName) throw new Error('APP_ENV must be set to make firm keys (KMS_MODE=kms)');
    if (typeof businessId !== 'string' || !UUID.test(businessId)) {
      throw new Error('A firm key needs the business id (a UUID)');
    }
    // Field encryption sends the lower-case id as the encryption context, and IAM compares it
    // with the tag case-sensitively.
    const id = businessId.toLowerCase();
    const alias = firmKeyAlias(this.envName, id);
    const existing = await this.find(alias, id);
    if (existing) {
      this.log(`Business ${id}: key ${existing} already named ${alias}`);
      return existing;
    }

    const created = await this.kms.send(
      new CreateKeyCommand({
        Description: `Firmivra ${this.envName}: field encryption for business ${id}`,
        KeySpec: 'SYMMETRIC_DEFAULT',
        KeyUsage: 'ENCRYPT_DECRYPT',
        // Sent, not left to defaults: IAM requires both (kms:KeyOrigin, kms:MultiRegion).
        Origin: 'AWS_KMS',
        MultiRegion: false,
        // No Policy and no BypassPolicyLockoutSafetyCheck: KMS's default key policy (above).
        Tags: firmKeyTags(this.envName, id),
      }),
    );
    const arn = created.KeyMetadata?.Arn;
    if (!arn) throw new Error('KMS returned no key');
    this.log(`Business ${id}: created key ${arn}`);

    const named = await this.name(alias, arn);
    if (named.kind === 'taken') {
      // Another call named its key a moment earlier: use that one, after the same checks.
      let winner: string | null;
      try {
        winner = await this.findWithin(alias, id);
      } catch (error) {
        if (error instanceof FirmKeyError) {
          throw new FirmKeyError(
            `${error.message}. Key ${arn} was made but not named; it holds no data`,
          );
        }
        throw error;
      }
      if (!winner) throw unnamed(id, arn, alias, 'AlreadyExistsException');
      this.log(`Business ${id}: ${alias} names key ${winner}; key ${arn} stays unused (no data)`);
      return winner;
    }
    if (named.kind === 'failed') throw unnamed(id, arn, alias, named.error);
    this.log(`Business ${id}: named key ${arn} ${alias}`);
    return arn;
  }

  /** Names the new key, retrying while KMS may not know it or its tags yet. */
  private async name(alias: string, arn: string): Promise<Naming> {
    let waited = 0;
    for (let attempt = 0; ; attempt++) {
      try {
        await this.kms.send(new CreateAliasCommand({ AliasName: alias, TargetKeyId: arn }));
        return { kind: 'named' };
      } catch (error) {
        const name = awsErrorName(error);
        if (name === 'AlreadyExistsException') return { kind: 'taken' };
        const delay = backoff(attempt);
        if (!NOT_READY.has(name) || waited + delay > this.aliasWaitMs) {
          return { kind: 'failed', error: name };
        }
        waited += delay;
        await this.sleep(delay);
      }
    }
  }

  /** `find`, retried while a key another call just named may not be visible yet. */
  private async findWithin(alias: string, id: string): Promise<string | null> {
    let waited = 0;
    for (let attempt = 0; ; attempt++) {
      try {
        const found = await this.find(alias, id);
        if (found) return found;
      } catch (error) {
        if (!NOT_READY.has(awsErrorName(error))) throw error;
      }
      const delay = backoff(attempt);
      if (waited + delay > this.aliasWaitMs) return null;
      waited += delay;
      await this.sleep(delay);
    }
  }

  /**
   * The key the alias names, or null when there is no such alias. Any other error (access
   * denied included) is passed on, so nothing is made when KMS can't tell. A key that is not
   * exactly like one this adapter makes is a FirmKeyError: never adopted, never replaced.
   */
  private async find(alias: string, id: string): Promise<string | null> {
    let key: KeyMetadata | undefined;
    try {
      key = (await this.kms.send(new DescribeKeyCommand({ KeyId: alias }))).KeyMetadata;
    } catch (error) {
      if (awsErrorName(error) === 'NotFoundException') return null;
      throw error;
    }
    // Disabled or being deleted: a person decides; never a second key behind the same alias.
    if (!key?.Arn || key.KeyState !== 'Enabled') {
      throw new FirmKeyError(`The key named ${alias} is not enabled; a person decides`);
    }
    const arn = key.Arn;
    const refuse = (what: string) =>
      new FirmKeyError(`The key ${arn} named ${alias} ${what}; a person decides`);

    const account = KEY_ARN.exec(arn)?.[1];
    if (!account || key.AWSAccountId !== account || key.KeyManager !== 'CUSTOMER') {
      throw refuse('is not a customer key of this account');
    }
    if (
      key.Origin !== 'AWS_KMS' ||
      key.MultiRegion !== false ||
      key.KeySpec !== 'SYMMETRIC_DEFAULT' ||
      key.KeyUsage !== 'ENCRYPT_DECRYPT'
    ) {
      throw refuse('is not a single-Region symmetric encryption key with KMS key material');
    }
    const tags = await this.kms.send(new ListResourceTagsCommand({ KeyId: arn }));
    if (tags.Truncated || !sameTags(tags.Tags ?? [], firmKeyTags(this.envName!, id))) {
      throw refuse(`does not carry exactly the firm tags of business ${id}`);
    }
    const policy = await this.kms.send(
      new GetKeyPolicyCommand({ KeyId: arn, PolicyName: 'default' }),
    );
    if (!isDefaultKeyPolicy(policy.Policy, account)) {
      throw refuse("has a key policy other than KMS's default");
    }
    const grants = await this.kms.send(new ListGrantsCommand({ KeyId: arn }));
    if (grants.Truncated || (grants.Grants ?? []).length > 0) throw refuse('has grants');
    return arn;
  }

  private log(line: string): void {
    this.logger?.log(line);
  }
}

/** A single-Region key ARN; group 1 is the account. */
const KEY_ARN = /^arn:aws:kms:[a-z0-9-]+:(\d{12}):key\/[0-9a-f-]{36}$/;

/** The three tags every firm key gets, in this order. */
export function firmKeyTags(envName: string, businessId: string): Tag[] {
  return [
    { TagKey: FIRM_KEY_TAGS.env, TagValue: envName },
    { TagKey: FIRM_KEY_TAGS.businessId, TagValue: businessId },
    { TagKey: FIRM_KEY_TAGS.purpose, TagValue: FIRM_KEY_PURPOSE },
  ];
}

/** The same tags in any order, and no others. */
function sameTags(actual: readonly Tag[], expected: readonly Tag[]): boolean {
  const want = new Set(expected.map((t) => JSON.stringify([t.TagKey, t.TagValue])));
  return (
    actual.length === expected.length &&
    actual.every((t) => want.delete(JSON.stringify([t.TagKey, t.TagValue])))
  );
}

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/**
 * True only for KMS's default key policy of keys made through the API: one statement that allows
 * kms:* on the key to the account root of `account`, with no condition. The Id and Sid may be any
 * string (they grant nothing).
 */
export function isDefaultKeyPolicy(policy: string | undefined, account: string): boolean {
  let doc: unknown;
  try {
    doc = JSON.parse(policy ?? '');
  } catch {
    return false;
  }
  if (!isObject(doc)) return false;
  const { Version, Id, Statement, ...rest } = doc;
  if (
    Object.keys(rest).length > 0 ||
    Version !== '2012-10-17' ||
    (Id !== undefined && typeof Id !== 'string') ||
    !Array.isArray(Statement) ||
    Statement.length !== 1
  ) {
    return false;
  }
  const statement: unknown = Statement[0];
  if (!isObject(statement)) return false;
  const { Sid, Effect, Principal, Action, Resource, ...other } = statement;
  return (
    Object.keys(other).length === 0 &&
    (Sid === undefined || typeof Sid === 'string') &&
    Effect === 'Allow' &&
    isObject(Principal) &&
    Object.keys(Principal).length === 1 &&
    Principal['AWS'] === `arn:aws:iam::${account}:root` &&
    Action === 'kms:*' &&
    Resource === '*'
  );
}

type Naming = { kind: 'named' } | { kind: 'taken' } | { kind: 'failed'; error: string };

/** The operator schedules the unnamed key's deletion; the API cannot delete keys. */
const unnamed = (id: string, arn: string, alias: string, error: string) =>
  new FirmKeyError(
    `Business ${id}: key ${arn} was made but not named ${alias} (${error}); it holds no data`,
  );

/** 2, 4, 8, 16, then 30 seconds. */
function backoff(attempt: number): number {
  return Math.min(2_000 * 2 ** attempt, 30_000);
}

/** `kms` is for tests (a fake KMS); otherwise the SDK's client with the task role. */
export function createFirmKeys(
  config: FirmKeysConfig,
  { kms, ...options }: AwsFirmKeysOptions & { kms?: Pick<KMSClient, 'send'> } = {},
): FirmKeys {
  return config.mode === 'local'
    ? new LocalFirmKeys()
    : new AwsFirmKeys(kms ?? new KMSClient({}), config.envName, options);
}
