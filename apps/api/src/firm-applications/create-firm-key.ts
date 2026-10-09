import { randomUUID } from 'node:crypto';
import { KMSClient } from '@aws-sdk/client-kms';
import { createDatabase, type Database } from '@firmivra/db';
import { AuditService } from '../audit/audit.service.js';
import { loadEnv } from '../config/env.js';
import {
  AwsKmsKeyWrapper,
  FieldEncryptionError,
  type KeyWrapper,
} from '../field-encryption/key-wrapper.js';
import {
  awsErrorName,
  createFirmKeys,
  FirmKeyError,
  type FirmKeys,
  loadFirmKeysConfig,
} from './firm-keys.js';

/**
 * One-off command: gives an existing firm its own KMS key (LVP on dev, which was created before
 * approve existed). The same FirmKeys adapter approve uses (R4 step 3). Rasel runs it as a
 * one-off ECS task on the API task definition with a command override:
 *   ["node", "dist/firm-applications/create-firm-key.cli.js", "lvp"]
 *   ["node", "dist/firm-applications/create-firm-key.cli.js", "lvp", "--check"]
 * Safe to repeat: a firm that has a key keeps it, and KMS finds an existing key by its alias.
 * Runs only where APP_ENV=dev. Prints ids, key ARNs and alias names only: never key material, a
 * database URL or any other setting.
 */

/** A reason not to run, in our own words (no values from settings or AWS). */
export class CommandRefusal extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CommandRefusal';
  }
}

export interface CommandArgs {
  slug: string;
  /** Prove the stored key wraps for its own firm and refuses another firm id. */
  check: boolean;
}

/** R0's businesses_slug_format. */
const SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/;
/** A single-region key ARN, so businesses_kms_key_id_not_blank can never be hit. */
const KEY_ARN = /^arn:aws:kms:[a-z0-9-]+:\d{12}:key\/[0-9a-f-]{36}$/;

export const KEY_SET_ACTION = 'business.kms_key_set';

export function commandArgs(
  argv: readonly string[],
  raw: Record<string, string | undefined>,
): CommandArgs {
  if (raw['APP_ENV'] !== 'dev') {
    throw new CommandRefusal('this command runs only where APP_ENV is dev (the dev API task)');
  }
  let mode: 'local' | 'kms';
  try {
    mode = loadFirmKeysConfig(raw).mode;
  } catch (error) {
    // The settings loaders name the setting and the rule, never its value.
    throw new CommandRefusal(error instanceof Error ? error.message : 'invalid KMS settings');
  }
  if (mode !== 'kms') throw new CommandRefusal('KMS_MODE must be kms (local mode makes no keys)');

  const flags = argv.filter((a) => a.startsWith('-'));
  const positional = argv.filter((a) => !a.startsWith('-'));
  if (flags.some((f) => f !== '--check')) {
    throw new CommandRefusal('the only option is --check');
  }
  if (positional.length !== 1) {
    throw new CommandRefusal('give one firm slug, for example: lvp');
  }
  const slug = positional[0]!;
  if (slug.length > 63 || !SLUG.test(slug)) {
    throw new CommandRefusal('a firm slug is lower-case letters and digits with single hyphens');
  }
  return { slug, check: flags.includes('--check') };
}

export interface CommandDeps {
  database: Database;
  keys: FirmKeys;
  say: (line: string) => void;
}

/** The firm by slug, read in platform scope (it sees every firm's row, no firm data). */
async function firmBySlug(database: Database, slug: string) {
  const firm = await database.withScope({ kind: 'platform' }, (tx) =>
    tx.business.findUnique({ where: { slug }, select: { id: true, kmsKeyId: true } }),
  );
  if (!firm) throw new CommandRefusal(`no firm has the slug ${slug}`);
  return firm;
}

/**
 * Makes (or finds) the firm's key and stores it on the firm, with a platform audit row. All
 * database work runs in platform scope: R0's businesses_protected_columns lets only platform scope
 * change kms_key_id. No transaction is held across the KMS calls. Returns the key's ARN.
 */
export async function createFirmKey(deps: CommandDeps, slug: string): Promise<string> {
  const { database, keys, say } = deps;
  const firm = await firmBySlug(database, slug);
  if (firm.kmsKeyId) {
    say(`Firm ${slug} (${firm.id}) already has key ${firm.kmsKeyId}; nothing changed`);
    return firm.kmsKeyId;
  }

  const arn = await keys.ensureKey(firm.id);
  if (!arn || !KEY_ARN.test(arn)) {
    throw new CommandRefusal('the key adapter returned no key ARN; nothing stored');
  }

  const audit = new AuditService(database);
  const result = await database.withScope({ kind: 'platform' }, async (tx) => {
    const { count } = await tx.business.updateMany({
      where: { id: firm.id, kmsKeyId: null },
      data: { kmsKeyId: arn },
    });
    if (count === 1) {
      // No request: no firm and no actor on the row (a platform event).
      await audit.logIn(tx, KEY_SET_ACTION, { type: 'business', id: firm.id }, { keyArn: arn });
      return { stored: true, current: arn };
    }
    const now = await tx.business.findUnique({
      where: { id: firm.id },
      select: { kmsKeyId: true },
    });
    return { stored: false, current: now?.kmsKeyId ?? null };
  });

  if (result.stored) {
    say(`Firm ${slug} (${firm.id}): stored key ${arn}`);
  } else if (result.current === arn) {
    // Another run stored the same key a moment earlier.
    say(`Firm ${slug} (${firm.id}) already has key ${arn}; nothing changed`);
  } else {
    throw new CommandRefusal(
      `firm ${slug} (${firm.id}) got key ${result.current ?? 'none'} meanwhile; key ${arn} was not stored`,
    );
  }
  return arn;
}

export interface CheckDeps {
  database: Database;
  wrapper: KeyWrapper;
  say: (line: string) => void;
}

/**
 * Proves the IAM rule on the real key before any data uses it: a data key for the firm's own id
 * wraps and unwraps, and one for any other id is refused (the encryption context's businessId must
 * equal the key's businessId tag). Every plain data key is zeroed at once.
 */
export async function checkFirmKey(deps: CheckDeps, slug: string): Promise<void> {
  const { database, wrapper, say } = deps;
  const firm = await firmBySlug(database, slug);
  const arn = firm.kmsKeyId;
  if (!arn)
    throw new CommandRefusal(`firm ${slug} (${firm.id}) has no key yet; run without --check`);

  let own;
  try {
    own = await wrapper.generate(firm.id, arn);
  } catch (error) {
    if (error instanceof FieldEncryptionError && error.code === 'KEY_ACCESS_DENIED') {
      throw new CommandRefusal(
        `key ${arn} refused a data key for its own business ${firm.id}. Tags can take up to five minutes to reach KMS authorization; run --check again`,
      );
    }
    throw error;
  }
  try {
    const back = await wrapper.unwrap(firm.id, arn, own.wrapped);
    const same = back.equals(own.plaintext);
    back.fill(0);
    if (!same) throw new CommandRefusal(`key ${arn} unwrapped a different data key`);
  } finally {
    own.plaintext.fill(0);
  }

  const other = randomUUID();
  try {
    const leaked = await wrapper.generate(other, arn);
    leaked.plaintext.fill(0);
  } catch (error) {
    if (error instanceof FieldEncryptionError && error.code === 'KEY_ACCESS_DENIED') {
      say(
        `Check: key ${arn} wraps and unwraps a data key for business ${firm.id}, and refuses another business id`,
      );
      return;
    }
    throw error;
  }
  throw new CommandRefusal(
    `key ${arn} made a data key for another business id: the IAM rule on the encryption context does not hold. Stop and tell Rasel; store no data with it`,
  );
}

export interface RunOverrides {
  /** Tests: the test database (left connected) and a fake KMS. */
  database?: Database;
  kms?: Pick<KMSClient, 'send'>;
  sleep?: (ms: number) => Promise<void>;
}

/** The command: returns the exit code. A refusal never opens the database. */
export async function runCreateFirmKey(
  argv: readonly string[],
  raw: Record<string, string | undefined>,
  say: (line: string) => void,
  overrides: RunOverrides = {},
): Promise<number> {
  let args: CommandArgs;
  try {
    args = commandArgs(argv, raw);
  } catch (error) {
    say(`Refused: ${error instanceof CommandRefusal ? error.message : awsErrorName(error)}`);
    return 1;
  }

  let owned: Database | undefined;
  try {
    let database = overrides.database;
    if (!database) {
      let url: string;
      try {
        // The API's own settings: the database URL from the task's DB_* values (verify-full).
        url = loadEnv(raw).DATABASE_URL_APP;
      } catch (error) {
        throw new CommandRefusal(error instanceof Error ? error.message : 'invalid API settings');
      }
      // The app role (no BYPASSRLS), never the owner.
      owned = createDatabase(url);
      database = owned;
    }
    const kms = overrides.kms ?? new KMSClient({});
    if (args.check) {
      const wrapper = new AwsKmsKeyWrapper(kms, { warn: (line: string) => say(line) });
      await checkFirmKey({ database, wrapper, say }, args.slug);
    } else {
      const keys = createFirmKeys(loadFirmKeysConfig(raw), {
        kms,
        logger: { log: (line: string) => say(line) },
        ...(overrides.sleep ? { sleep: overrides.sleep } : {}),
      });
      await createFirmKey({ database, keys, say }, args.slug);
    }
    return 0;
  } catch (error) {
    if (error instanceof CommandRefusal) say(`Refused: ${error.message}`);
    else if (error instanceof FirmKeyError) say(`Failed: ${error.message}`);
    else if (error instanceof FieldEncryptionError) say(`Failed: ${error.code}`);
    else say(`Failed: ${awsErrorName(error)}`);
    return 1;
  } finally {
    await owned?.disconnect();
  }
}
