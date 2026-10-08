// Each firm's own KMS key (R1 step 14, for R4 approve and the create-firm-key command), against
// a fake KMS (test/fake-kms.ts): these tests never call AWS.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CreateKeyCommand, DescribeKeyCommand } from '@aws-sdk/client-kms';
import { describe, expect, it } from 'vitest';
import {
  AwsFirmKeys,
  createFirmKeys,
  FIRM_KEY_PURPOSE,
  FIRM_KEY_TAGS,
  FirmKeyError,
  firmKeyAlias,
  loadFirmKeysConfig,
  LocalFirmKeys,
} from '../../src/firm-applications/firm-keys.js';
import { fakeKms, named } from '../fake-kms.js';

const FIRM = '0199b6a3-0000-7000-8000-00000000000f';
const ALIAS = `alias/firmivra/dev/business/${FIRM}`;
const localKey = Buffer.from(Array.from({ length: 32 }, (_, i) => i)).toString('base64');

/** Records log lines and sleeps; sleeps return at once. */
function harness(kms: ReturnType<typeof fakeKms>['kms'], aliasWaitMs?: number) {
  const lines: string[] = [];
  const sleeps: number[] = [];
  const keys = new AwsFirmKeys(kms, 'dev', {
    logger: { log: (line: string) => lines.push(line) },
    sleep: async (ms) => {
      sleeps.push(ms);
    },
    ...(aliasWaitMs === undefined ? {} : { aliasWaitMs }),
  });
  return { keys, lines, sleeps };
}

describe('settings: KMS_MODE picks the adapter', () => {
  it('local mode makes no key; AWS KMS is the default', async () => {
    const local = createFirmKeys(
      loadFirmKeysConfig({ NODE_ENV: 'test', KMS_MODE: 'local', LOCAL_KMS_KEY: localKey }),
    );
    expect(local).toBeInstanceOf(LocalFirmKeys);
    await expect(local.ensureKey(FIRM)).resolves.toBeNull();

    expect(loadFirmKeysConfig({})).toEqual({ mode: 'kms', envName: null });
    const aws = createFirmKeys(loadFirmKeysConfig({ KMS_MODE: 'kms', APP_ENV: 'dev' }));
    expect(aws).toBeInstanceOf(AwsFirmKeys);
    expect(aws.mode).toBe('kms');
  });

  it("follows field encryption's rules, and checks APP_ENV", () => {
    expect(() =>
      loadFirmKeysConfig({ NODE_ENV: 'production', KMS_MODE: 'local', LOCAL_KMS_KEY: localKey }),
    ).toThrow(/only allowed when NODE_ENV is development or test/);
    expect(() => loadFirmKeysConfig({ KMS_MODE: 'kms', APP_ENV: 'Dev Env' })).toThrow(/APP_ENV/);
    expect(loadFirmKeysConfig({ KMS_MODE: 'kms', APP_ENV: '' })).toEqual({
      mode: 'kms',
      envName: null,
    });
  });
});

describe('AwsFirmKeys', () => {
  it('makes a key tagged for the firm with the default key policy, names it, returns its ARN', async () => {
    const fake = fakeKms();
    const { keys, lines } = harness(fake.kms);
    const arn = await keys.ensureKey(FIRM);
    expect(arn).toMatch(/^arn:aws:kms:us-east-1:000000000000:key\//);
    expect(fake.aliases.get(ALIAS)).toBe(arn);
    expect(firmKeyAlias('dev', FIRM)).toBe(ALIAS);
    expect(fake.names()).toEqual(['DescribeKey', 'CreateKey', 'CreateAlias']);
    const create = fake.calls.find((c) => c instanceof CreateKeyCommand) as CreateKeyCommand;
    expect(create.input).toEqual({
      Description: `Firmivra dev: field encryption for business ${FIRM}`,
      KeySpec: 'SYMMETRIC_DEFAULT',
      KeyUsage: 'ENCRYPT_DECRYPT',
      Tags: [
        { TagKey: 'firmivra:env', TagValue: 'dev' },
        { TagKey: 'firmivra:businessId', TagValue: FIRM },
        { TagKey: 'firmivra:purpose', TagValue: 'firm-data' },
      ],
    });
    // Lead rule 3: no Policy, so KMS attaches its default (account root); never the bypass.
    expect(create.input).not.toHaveProperty('Policy');
    expect(create.input).not.toHaveProperty('BypassPolicyLockoutSafetyCheck');
    // The same names as the IAM policy (infra/src/firm-key-policy.ts).
    expect(FIRM_KEY_TAGS).toEqual({
      env: 'firmivra:env',
      businessId: 'firmivra:businessId',
      purpose: 'firmivra:purpose',
    });
    expect(FIRM_KEY_PURPOSE).toBe('firm-data');
    expect(lines).toEqual([
      `Business ${FIRM}: created key ${arn}`,
      `Business ${FIRM}: named key ${arn} ${ALIAS}`,
    ]);
  });

  it('uses the lower-case id in the tag and the alias, and makes no call for an invalid id', async () => {
    const fake = fakeKms();
    const { keys } = harness(fake.kms);
    const arn = await keys.ensureKey(FIRM.toUpperCase());
    expect(fake.aliases.get(ALIAS)).toBe(arn);
    expect(fake.keys.get(arn)?.tags).toContainEqual({
      TagKey: 'firmivra:businessId',
      TagValue: FIRM,
    });

    const empty = fakeKms();
    const other = harness(empty.kms).keys;
    for (const bad of ['', 'lvp', `${FIRM}x`, '*']) {
      await expect(other.ensureKey(bad)).rejects.toThrow(/UUID/);
    }
    expect(empty.calls).toEqual([]);
  });

  it('is safe to repeat: the second call finds the same key and makes none', async () => {
    const fake = fakeKms();
    const { keys, lines } = harness(fake.kms);
    const first = await keys.ensureKey(FIRM);
    fake.calls.length = 0;
    lines.length = 0;
    await expect(keys.ensureKey(FIRM)).resolves.toBe(first);
    expect(fake.calls).toHaveLength(1);
    expect(fake.calls[0]).toBeInstanceOf(DescribeKeyCommand);
    expect(lines).toEqual([`Business ${FIRM}: key ${first} already named ${ALIAS}`]);
  });

  it('uses the key another call named first, and logs the unused one', async () => {
    const winner = 'arn:aws:kms:us-east-1:000000000000:key/0199b6a3-0000-7000-8000-0000000000aa';
    const fake = fakeKms({ aliasTakenBy: winner });
    const { keys, lines } = harness(fake.kms);
    await expect(keys.ensureKey(FIRM)).resolves.toBe(winner);
    const made = [...fake.keys.keys()].find((k) => k !== winner)!;
    expect(lines.at(-1)).toBe(
      `Business ${FIRM}: ${ALIAS} names key ${winner}; key ${made} stays unused (no data)`,
    );
  });

  it('keeps naming a new key while its tags reach authorization, within the wait', async () => {
    const fake = fakeKms({ aliasErrors: ['AccessDeniedException', 'NotFoundException'] });
    const { keys, sleeps } = harness(fake.kms);
    const arn = await keys.ensureKey(FIRM);
    expect(fake.aliases.get(ALIAS)).toBe(arn);
    expect(sleeps).toEqual([2_000, 4_000]);
    expect(fake.names().filter((n) => n === 'CreateKey')).toHaveLength(1);
  });

  it('backs off 2, 4, 8, 16, then 30 s, and stops at the wait: the error names the unnamed key', async () => {
    const fake = fakeKms({ aliasErrors: Array<string>(20).fill('AccessDeniedException') });
    const { keys, sleeps } = harness(fake.kms, 60_000);
    const error = await keys.ensureKey(FIRM).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(FirmKeyError);
    const made = [...fake.keys.keys()][0]!;
    expect((error as Error).message).toBe(
      `Business ${FIRM}: key ${made} was made but not named ${ALIAS} (AccessDeniedException); it holds no data`,
    );
    expect(sleeps).toEqual([2_000, 4_000, 8_000, 16_000, 30_000]);
    expect(sleeps.reduce((a, b) => a + b, 0)).toBeLessThanOrEqual(60_000);
    expect(fake.names().filter((n) => n === 'CreateKey')).toHaveLength(1);

    const longer = fakeKms({ aliasErrors: Array<string>(7).fill('KMSInvalidStateException') });
    const { keys: patient, sleeps: waited } = harness(longer.kms);
    await expect(patient.ensureKey(FIRM)).resolves.toMatch(/^arn:aws:kms:/);
    expect(waited).toEqual([2_000, 4_000, 8_000, 16_000, 30_000, 30_000, 30_000]);
  });

  it('does not retry other naming errors', async () => {
    const fake = fakeKms({ aliasErrors: ['LimitExceededException'] });
    const { keys, sleeps } = harness(fake.kms);
    await expect(keys.ensureKey(FIRM)).rejects.toThrow(
      /was made but not named .* \(LimitExceededException\); it holds no data/,
    );
    expect(sleeps).toEqual([]);
  });

  it('refuses a key that is not enabled, and makes nothing without APP_ENV', async () => {
    const disabled = fakeKms({ keyState: 'PendingDeletion' });
    const { keys } = harness(disabled.kms);
    await keys.ensureKey(FIRM); // makes it; the fake marks it pending deletion
    disabled.calls.length = 0;
    await expect(keys.ensureKey(FIRM)).rejects.toThrow(/not enabled/);
    expect(disabled.names()).toEqual(['DescribeKey']);

    const fake = fakeKms();
    await expect(new AwsFirmKeys(fake.kms, null).ensureKey(FIRM)).rejects.toThrow(/APP_ENV/);
    expect(fake.calls).toEqual([]);
  });

  it('passes on any other error when looking for the key, and makes nothing (fail closed)', async () => {
    const fake = fakeKms({ describeError: 'AccessDeniedException' });
    await expect(harness(fake.kms).keys.ensureKey(FIRM)).rejects.toMatchObject({
      name: 'AccessDeniedException',
    });
    expect(fake.names()).toEqual(['DescribeKey']);

    const throttled = { send: () => Promise.reject(named('ThrottlingException')) };
    await expect(new AwsFirmKeys(throttled as never, 'dev').ensureKey(FIRM)).rejects.toMatchObject({
      name: 'ThrottlingException',
    });
  });

  it('logs ids, key ARNs and alias names only', async () => {
    const fake = fakeKms({ aliasErrors: ['AccessDeniedException'] });
    const { keys, lines } = harness(fake.kms);
    await keys.ensureKey(FIRM);
    await keys.ensureKey(FIRM);
    const allowed =
      /^Business [0-9a-f-]{36}: (created key |named key |key )arn:aws:kms:[a-z0-9-]+:\d{12}:key\/[0-9a-f-]{36}( alias\/firmivra\/dev\/business\/[0-9a-f-]{36}| already named alias\/firmivra\/dev\/business\/[0-9a-f-]{36})?$/;
    expect(lines.length).toBeGreaterThan(0);
    for (const line of lines) expect(line).toMatch(allowed);
    expect(lines.join('\n')).not.toMatch(/fake detail/);
  });
});

describe('who may make a firm key (lead rule 4)', () => {
  const src = fileURLToPath(new URL('../../src', import.meta.url));
  const files = (dir: string): string[] =>
    readdirSync(dir).flatMap((name) => {
      const path = join(dir, name);
      return statSync(path).isDirectory() ? files(path) : path.endsWith('.ts') ? [path] : [];
    });
  const using = (pattern: RegExp) =>
    files(src)
      .filter((f) => pattern.test(readFileSync(f, 'utf8')))
      .map((f) => relative(src, f).replaceAll('\\', '/'))
      .sort();

  it('sends CreateKey and CreateAlias only from the adapter, and calls it only from the command', () => {
    expect(using(/CreateKeyCommand|CreateAliasCommand/)).toEqual([
      'firm-applications/firm-keys.ts',
    ]);
    // R4 approve adds itself here when it lands.
    expect(using(/\.ensureKey\(/)).toEqual(['firm-applications/create-firm-key.ts']);
  });
});
