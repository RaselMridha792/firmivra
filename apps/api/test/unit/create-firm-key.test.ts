// The one-off create-firm-key command (R1 step 14): its refusals, platform scope only, and
// --check against a fake KMS that applies the API role's encryption-context rule.
import type { Database, Scope, TxClient } from '@firmivra/db';
import { describe, expect, it } from 'vitest';
import {
  checkFirmKey,
  commandArgs,
  runCreateFirmKey,
} from '../../src/firm-applications/create-firm-key.js';
import { AwsKmsKeyWrapper, type KeyWrapper } from '../../src/field-encryption/key-wrapper.js';
import { AwsFirmKeys } from '../../src/firm-applications/firm-keys.js';
import { fakeKms } from '../fake-kms.js';

const FIRM = '0199b6a3-0000-7000-8000-0000000000c1';
const DEV = { APP_ENV: 'dev', KMS_MODE: 'kms' };
const localKey = Buffer.from(Array.from({ length: 32 }, (_, i) => i)).toString('base64');

/** A database that records each scope and answers from one firm row; no real connection. */
function stubDatabase(row: { id: string; kmsKeyId: string | null } | null) {
  const scopes: Scope[] = [];
  let disconnected = false;
  const tx = {
    business: {
      findUnique: async () => row && { ...row },
      updateMany: async ({ data }: { data: { kmsKeyId: string } }) => {
        if (!row || row.kmsKeyId) return { count: 0 };
        row.kmsKeyId = data.kmsKeyId;
        return { count: 1 };
      },
    },
    auditLog: { create: async () => ({}) },
  };
  const database = {
    withScope: async <T>(scope: Scope, fn: (t: TxClient) => Promise<T>) => {
      scopes.push(scope);
      return fn(tx as unknown as TxClient);
    },
    disconnect: async () => {
      disconnected = true;
    },
  } as unknown as Database;
  return { database, scopes, disconnected: () => disconnected };
}

const run = async (argv: string[], raw: Record<string, string | undefined>) => {
  const lines: string[] = [];
  const code = await runCreateFirmKey(argv, raw, (line) => lines.push(line));
  return { code, lines };
};

describe('commandArgs', () => {
  it('runs only with APP_ENV=dev and KMS_MODE=kms', () => {
    for (const raw of [
      {},
      { KMS_MODE: 'kms' },
      { APP_ENV: 'prod', KMS_MODE: 'kms' },
      { APP_ENV: 'Dev', KMS_MODE: 'kms' },
      { APP_ENV: 'dev ', KMS_MODE: 'kms' },
    ]) {
      expect(() => commandArgs(['lvp'], raw)).toThrow(/only where APP_ENV is dev/);
    }
    expect(() =>
      commandArgs(['lvp'], {
        APP_ENV: 'dev',
        NODE_ENV: 'test',
        KMS_MODE: 'local',
        LOCAL_KMS_KEY: localKey,
      }),
    ).toThrow(/KMS_MODE must be kms/);
    expect(commandArgs(['lvp'], DEV)).toEqual({ slug: 'lvp', check: false });
    expect(commandArgs(['lvp', '--check'], DEV)).toEqual({ slug: 'lvp', check: true });
  });

  it('takes one valid slug and no option but --check', () => {
    for (const argv of [[], ['lvp', 'other'], ['LVP'], ['lvp-'], ['a--b'], ['x'.repeat(64)]]) {
      expect(() => commandArgs(argv, DEV)).toThrow(/slug/);
    }
    for (const argv of [
      ['lvp', '--force'],
      ['-c', 'lvp'],
      ['lvp', '--check=yes'],
    ]) {
      expect(() => commandArgs(argv, DEV)).toThrow(/only option is --check/);
    }
  });

  it('refuses before any database or KMS work, and prints no setting', async () => {
    for (const raw of [
      { ...DEV, APP_ENV: 'prod' },
      { ...DEV, KMS_MODE: 'nope' },
    ]) {
      const { code, lines } = await run(['lvp'], {
        ...raw,
        DATABASE_URL_APP: 'postgresql://x:secret-pw@h/db',
      });
      expect(code).toBe(1);
      expect(lines).toHaveLength(1);
      expect(lines[0]).toMatch(/^Refused: /);
      expect(lines[0]).not.toMatch(/secret-pw|prod|nope/);
    }
  });

  it('refuses when the API settings do not validate, without printing them', async () => {
    const { code, lines } = await run(['lvp'], { ...DEV, DB_APP_PASSWORD: 'secret-pw' });
    expect(code).toBe(1);
    expect(lines.join('\n')).toMatch(/^Refused: Invalid API environment/);
    expect(lines.join('\n')).not.toMatch(/secret-pw/);
  });
});

describe('runCreateFirmKey with a stub database', () => {
  it('stores the key in platform scope only, and leaves a database it did not open connected', async () => {
    const row = { id: FIRM, kmsKeyId: null as string | null };
    const db = stubDatabase(row);
    const fake = fakeKms();
    const lines: string[] = [];
    const code = await runCreateFirmKey(['lvp'], DEV, (l) => lines.push(l), {
      database: db.database,
      kms: fake.kms,
    });
    expect(code).toBe(0);
    expect(row.kmsKeyId).toMatch(/^arn:aws:kms:us-east-1:000000000000:key\//);
    expect(db.scopes.length).toBeGreaterThan(0);
    expect(db.scopes.every((s) => s.kind === 'platform')).toBe(true);
    expect(db.disconnected()).toBe(false);
    expect(lines.at(-1)).toBe(`Firm lvp (${FIRM}): stored key ${row.kmsKeyId}`);
  });

  it('refuses an unknown slug and prints AWS errors by name only', async () => {
    const none = await runCreateFirmKey(['lvp'], DEV, () => {}, {
      database: stubDatabase(null).database,
      kms: fakeKms().kms,
    });
    expect(none).toBe(1);

    const lines: string[] = [];
    const code = await runCreateFirmKey(['lvp'], DEV, (l) => lines.push(l), {
      database: stubDatabase({ id: FIRM, kmsKeyId: null }).database,
      kms: fakeKms({ describeError: 'AccessDeniedException' }).kms,
    });
    expect(code).toBe(1);
    expect(lines).toEqual(['Failed: AccessDeniedException']);
  });
});

describe('--check (lead rule 2 on the real key)', () => {
  /** A firm with its key made by the adapter, as the first run leaves it. */
  async function keyedFirm(options: Parameters<typeof fakeKms>[0] = {}) {
    const fake = fakeKms(options);
    const arn = await new AwsFirmKeys(fake.kms, 'dev').ensureKey(FIRM);
    return { fake, arn, db: stubDatabase({ id: FIRM, kmsKeyId: arn }) };
  }

  /** Wraps the real wrapper and keeps every plain key it returned, to see them zeroed. */
  function recording(wrapper: KeyWrapper) {
    const plain: Buffer[] = [];
    const recorder: KeyWrapper = {
      mode: wrapper.mode,
      generate: async (id, key) => {
        const out = await wrapper.generate(id, key);
        plain.push(out.plaintext);
        return out;
      },
      unwrap: async (id, key, wrapped) => {
        const out = await wrapper.unwrap(id, key, wrapped);
        plain.push(out);
        return out;
      },
    };
    return { recorder, plain };
  }

  it("passes when the firm's own id wraps and unwraps and another id is refused", async () => {
    const { fake, arn, db } = await keyedFirm();
    const lines: string[] = [];
    const code = await runCreateFirmKey(['lvp', '--check'], DEV, (l) => lines.push(l), {
      database: db.database,
      kms: fake.kms,
    });
    expect(code).toBe(0);
    expect(lines.at(-1)).toBe(
      `Check: key ${arn} wraps and unwraps a data key for business ${FIRM}, and refuses another business id`,
    );
    // KMS's own buffers are zeroed by the wrapper.
    expect(fake.handed.length).toBe(2);
    for (const bytes of fake.handed) expect(bytes.every((b) => b === 0)).toBe(true);
  });

  it('zeroes every plain data key and prints no key bytes', async () => {
    const { fake, arn, db } = await keyedFirm();
    const { recorder, plain } = recording(new AwsKmsKeyWrapper(fake.kms, { warn: () => {} }));
    const lines: string[] = [];
    await checkFirmKey(
      { database: db.database, wrapper: recorder, say: (l) => lines.push(l) },
      'lvp',
    );
    expect(plain).toHaveLength(2);
    for (const key of plain) expect(key.every((b) => b === 0)).toBe(true);
    expect(lines).toEqual([expect.stringContaining(arn)]);
  });

  it('fails when another business id may use the key (the rule does not hold)', async () => {
    const { fake, db } = await keyedFirm({ ignoreContext: true });
    const lines: string[] = [];
    const code = await runCreateFirmKey(['lvp', '--check'], DEV, (l) => lines.push(l), {
      database: db.database,
      kms: fake.kms,
    });
    expect(code).toBe(1);
    expect(lines.at(-1)).toMatch(
      /^Refused: key .* made a data key for another business id: the IAM rule on the encryption context does not hold/,
    );
  });

  it('says to wait when the own id is refused (tags not yet in authorization), and needs a key', async () => {
    const { fake, arn } = await keyedFirm();
    // The key's tag names another firm, as if its tags had not reached authorization.
    fake.keys.get(arn)!.tags = [{ TagKey: 'firmivra:env', TagValue: 'dev' }];
    const lines: string[] = [];
    const code = await runCreateFirmKey(['lvp', '--check'], DEV, (l) => lines.push(l), {
      database: stubDatabase({ id: FIRM, kmsKeyId: arn }).database,
      kms: fake.kms,
    });
    expect(code).toBe(1);
    expect(lines.at(-1)).toMatch(/up to five minutes .* run --check again$/);

    const without: string[] = [];
    await runCreateFirmKey(['lvp', '--check'], DEV, (l) => without.push(l), {
      database: stubDatabase({ id: FIRM, kmsKeyId: null }).database,
      kms: fake.kms,
    });
    expect(without.at(-1)).toMatch(/has no key yet; run without --check$/);
  });
});
