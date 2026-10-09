// R4 step 3: each firm's own KMS key, made when approve creates the firm. A fake KMS stands in for
// AWS: these tests never call it.
import {
  CreateAliasCommand,
  CreateKeyCommand,
  DescribeKeyCommand,
  type KMSClient,
} from '@aws-sdk/client-kms';
import { describe, expect, it } from 'vitest';
import {
  AwsFirmKeys,
  createFirmKeys,
  FIRM_KEY_PURPOSE,
  firmKeyAlias,
  loadFirmKeysConfig,
  LocalFirmKeys,
} from '../../src/firm-applications/firm-keys.js';

const FIRM = '0199b6a3-0000-7000-8000-00000000000f';
const localKey = Buffer.from(Array.from({ length: 32 }, (_, i) => i + 1)).toString('base64');

const named = (name: string) => Object.assign(new Error(name), { name });

/** A stand-in for AWS KMS: keys and aliases in memory, KMS's errors by name. */
function fakeKms(options: { keyState?: string; aliasTakenBy?: string } = {}) {
  const aliases = new Map<string, string>();
  const keys = new Map<string, { state: string; tags: unknown }>();
  const calls: unknown[] = [];
  let next = 1;
  const kms = {
    send: async (command: unknown) => {
      calls.push(command);
      if (command instanceof DescribeKeyCommand) {
        const arn = aliases.get(command.input.KeyId!) ?? command.input.KeyId!;
        const key = keys.get(arn);
        if (!key) throw named('NotFoundException');
        return { KeyMetadata: { Arn: arn, KeyState: key.state } };
      }
      if (command instanceof CreateKeyCommand) {
        const arn = `arn:aws:kms:us-east-1:000000000000:key/fake-${next++}`;
        keys.set(arn, { state: options.keyState ?? 'Enabled', tags: command.input.Tags });
        return { KeyMetadata: { Arn: arn, KeyState: 'Enabled' } };
      }
      if (command instanceof CreateAliasCommand) {
        const { AliasName, TargetKeyId } = command.input;
        if (options.aliasTakenBy) {
          // Another approve named its key a moment earlier.
          keys.set(options.aliasTakenBy, { state: 'Enabled', tags: [] });
          aliases.set(AliasName!, options.aliasTakenBy);
        }
        if (aliases.has(AliasName!)) throw named('AlreadyExistsException');
        aliases.set(AliasName!, TargetKeyId!);
        return {};
      }
      throw new Error('unexpected command');
    },
  };
  return { kms: kms as unknown as Pick<KMSClient, 'send'>, calls, keys, aliases };
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
  it('makes a key tagged for the firm, names it by the alias, and returns its ARN', async () => {
    const { kms, calls, keys, aliases } = fakeKms();
    const arn = await new AwsFirmKeys(kms, 'dev').ensureKey(FIRM);
    expect(arn).toMatch(/^arn:aws:kms:/);
    expect(aliases.get(`alias/firmivra/dev/business/${FIRM}`)).toBe(arn);
    expect(firmKeyAlias('dev', FIRM)).toBe(`alias/firmivra/dev/business/${FIRM}`);
    expect(keys.get(arn)?.tags).toEqual([
      { TagKey: 'firmivra:purpose', TagValue: FIRM_KEY_PURPOSE },
      { TagKey: 'firmivra:environment', TagValue: 'dev' },
      { TagKey: 'firmivra:business-id', TagValue: FIRM },
    ]);
    const create = calls.find((c) => c instanceof CreateKeyCommand) as CreateKeyCommand;
    expect(create.input).toMatchObject({
      KeySpec: 'SYMMETRIC_DEFAULT',
      KeyUsage: 'ENCRYPT_DECRYPT',
    });
  });

  it('is safe to repeat: the second call finds the same key and makes none', async () => {
    const { kms, calls } = fakeKms();
    const keys = new AwsFirmKeys(kms, 'dev');
    const first = await keys.ensureKey(FIRM);
    calls.length = 0;
    await expect(keys.ensureKey(FIRM)).resolves.toBe(first);
    expect(calls).toHaveLength(1);
    expect(calls[0]).toBeInstanceOf(DescribeKeyCommand);
  });

  it('uses the key another approve named first when the alias is taken meanwhile', async () => {
    const winner = 'arn:aws:kms:us-east-1:000000000000:key/winner';
    const { kms } = fakeKms({ aliasTakenBy: winner });
    await expect(new AwsFirmKeys(kms, 'dev').ensureKey(FIRM)).resolves.toBe(winner);
  });

  it('refuses a key that is not enabled, and makes nothing without APP_ENV', async () => {
    const disabled = fakeKms({ keyState: 'PendingDeletion' });
    const keys = new AwsFirmKeys(disabled.kms, 'dev');
    await keys.ensureKey(FIRM); // makes it; the fake marks it pending deletion
    await expect(keys.ensureKey(FIRM)).rejects.toThrow(/not enabled/);

    const { kms, calls } = fakeKms();
    await expect(new AwsFirmKeys(kms, null).ensureKey(FIRM)).rejects.toThrow(/APP_ENV/);
    expect(calls).toEqual([]);
  });

  it('passes on any other KMS error', async () => {
    const kms = { send: () => Promise.reject(named('AccessDeniedException')) };
    await expect(
      new AwsFirmKeys(kms as unknown as Pick<KMSClient, 'send'>, 'dev').ensureKey(FIRM),
    ).rejects.toMatchObject({ name: 'AccessDeniedException' });
  });
});
