// R10 step 2: the field-encryption helper (SSN, date of birth). Envelope encryption with the
// firm's key, bound to firm, record and field; local mode only in development and test.
import { randomBytes, randomUUID } from 'node:crypto';
import { DecryptCommand, GenerateDataKeyCommand, type KMSClient } from '@aws-sdk/client-kms';
import { Test } from '@nestjs/testing';
import { describe, expect, it } from 'vitest';
import { loadFieldEncryptionConfig } from '../../src/field-encryption/config.js';
import {
  type FieldContext,
  FieldEncryption,
  FieldEncryptionError,
  FieldEncryptionModule,
} from '../../src/field-encryption/field-encryption.service.js';
import {
  AwsKmsKeyWrapper,
  LocalKeyWrapper,
  open,
  seal,
} from '../../src/field-encryption/key-wrapper.js';

const localKey = randomBytes(32);
const local = () => new FieldEncryption(new LocalKeyWrapper(localKey));
const ctx = (over: Partial<FieldContext> = {}): FieldContext => ({
  businessId: '0199b6a0-0000-7000-8000-00000000000a',
  kmsKeyId: null,
  recordId: '0199b6a1-0000-7000-8000-000000000001',
  field: 'ssn',
  ...over,
});
const SSN = '123456789'; // synthetic
const code = (error: unknown) => (error as FieldEncryptionError).code;

/**
 * A stand-in for AWS KMS: one AES key per KeyId; the encryption context must match on decrypt,
 * and a blob only decrypts under the key that wrapped it, as in KMS.
 */
function fakeKms() {
  const keys = new Map<string, Buffer>();
  const calls: unknown[] = [];
  const keyFor = (id: string) => {
    if (!keys.has(id)) keys.set(id, randomBytes(32));
    return keys.get(id)!;
  };
  const context = (c: Record<string, string> | undefined) => Buffer.from(JSON.stringify(c ?? {}));
  const kms = {
    send: async (command: unknown) => {
      calls.push(command);
      if (command instanceof GenerateDataKeyCommand) {
        const { KeyId, EncryptionContext } = command.input;
        const plaintext = randomBytes(32);
        const blob = Buffer.concat([
          Buffer.from(`${KeyId}|`),
          seal(keyFor(KeyId!), plaintext, context(EncryptionContext)),
        ]);
        return { Plaintext: new Uint8Array(plaintext), CiphertextBlob: new Uint8Array(blob) };
      }
      if (command instanceof DecryptCommand) {
        const { KeyId, CiphertextBlob, EncryptionContext } = command.input;
        const blob = Buffer.from(CiphertextBlob!);
        const sep = blob.indexOf('|');
        if (blob.subarray(0, sep).toString() !== KeyId) throw new Error('IncorrectKeyException');
        const plaintext = open(keyFor(KeyId), blob.subarray(sep + 1), context(EncryptionContext));
        return { Plaintext: new Uint8Array(plaintext) };
      }
      throw new Error('unexpected command');
    },
  };
  return { kms: kms as unknown as Pick<KMSClient, 'send'>, calls };
}

describe('field encryption (local mode)', () => {
  it('round-trips an SSN and a date of birth, with a new ciphertext every time', async () => {
    const fe = local();
    const a = await fe.encrypt(ctx(), SSN);
    const b = await fe.encrypt(ctx(), SSN);
    expect(Buffer.from(a).equals(Buffer.from(b))).toBe(false);
    expect(Buffer.from(a).includes(Buffer.from(SSN))).toBe(false);
    await expect(fe.decrypt(ctx(), a)).resolves.toBe(SSN);
    const dob = ctx({ field: 'date_of_birth' });
    await expect(fe.decrypt(dob, await fe.encrypt(dob, '1985-04-12'))).resolves.toBe('1985-04-12');
  });

  it('a value copied to another firm, record or field does not decrypt', async () => {
    const fe = local();
    const blob = await fe.encrypt(ctx(), SSN);
    for (const other of [
      ctx({ businessId: randomUUID() }),
      ctx({ recordId: randomUUID() }),
      ctx({ field: 'date_of_birth' }),
    ]) {
      const error = await fe.decrypt(other, blob).catch((e: unknown) => e);
      expect(code(error)).toBe('DECRYPTION_FAILED');
      expect(String(error)).not.toContain(SSN);
    }
  });

  it('any changed byte, or another local key, fails', async () => {
    const blob = Buffer.from(await local().encrypt(ctx(), SSN));
    for (const i of [5, blob.length - 20, blob.length - 1]) {
      const changed = Buffer.from(blob);
      changed[i] = changed[i]! ^ 1;
      expect(
        code(
          await local()
            .decrypt(ctx(), changed)
            .catch((e: unknown) => e),
        ),
      ).toBe('DECRYPTION_FAILED');
    }
    const otherKey = new FieldEncryption(new LocalKeyWrapper(randomBytes(32)));
    expect(code(await otherKey.decrypt(ctx(), blob).catch((e: unknown) => e))).toBe(
      'DECRYPTION_FAILED',
    );
  });

  it('refuses unknown formats and bad contexts', async () => {
    const fe = local();
    expect(code(await fe.decrypt(ctx(), new Uint8Array([9, 1, 0, 0])).catch((e) => e))).toBe(
      'UNSUPPORTED_FORMAT',
    );
    for (const bad of [ctx({ businessId: 'x' }), ctx({ field: 'ssn:x' }), ctx({ field: '' })]) {
      expect(code(await fe.encrypt(bad, SSN).catch((e: unknown) => e))).toBe('INVALID_CONTEXT');
    }
  });
});

describe('field encryption (AWS KMS mode)', () => {
  it("uses the firm's key with the firm as encryption context, and pins the key on decrypt", async () => {
    const { kms, calls } = fakeKms();
    const fe = new FieldEncryption(new AwsKmsKeyWrapper(kms));
    const keyA = 'arn:aws:kms:us-east-1:000000000000:key/firm-a';
    const blob = await fe.encrypt(ctx({ kmsKeyId: keyA }), SSN);
    await expect(fe.decrypt(ctx({ kmsKeyId: keyA }), blob)).resolves.toBe(SSN);

    const [generate, decrypt] = calls as [GenerateDataKeyCommand, DecryptCommand];
    expect(generate.input).toMatchObject({
      KeyId: keyA,
      KeySpec: 'AES_256',
      EncryptionContext: { businessId: ctx().businessId },
    });
    expect(decrypt.input).toMatchObject({
      KeyId: keyA,
      EncryptionContext: { businessId: ctx().businessId },
    });

    // Another firm's key, or another firm's context, cannot open it.
    const keyB = 'arn:aws:kms:us-east-1:000000000000:key/firm-b';
    expect(code(await fe.decrypt(ctx({ kmsKeyId: keyB }), blob).catch((e) => e))).toBe(
      'DECRYPTION_FAILED',
    );
    expect(
      code(
        await fe
          .decrypt(ctx({ kmsKeyId: keyA, businessId: randomUUID() }), blob)
          .catch((e: unknown) => e),
      ),
    ).toBe('DECRYPTION_FAILED');
  });

  it('a firm without a key gets KEY_NOT_PROVISIONED; a local value is refused', async () => {
    const fe = new FieldEncryption(new AwsKmsKeyWrapper(fakeKms().kms));
    expect(code(await fe.encrypt(ctx(), SSN).catch((e: unknown) => e))).toBe('KEY_NOT_PROVISIONED');
    const localBlob = await local().encrypt(ctx(), SSN);
    expect(code(await fe.decrypt(ctx({ kmsKeyId: 'k' }), localBlob).catch((e) => e))).toBe(
      'WRONG_MODE',
    );
  });
});

describe('settings', () => {
  const key = Buffer.alloc(32, 7).toString('base64');

  it('defaults to AWS KMS', () => {
    expect(loadFieldEncryptionConfig({})).toEqual({ mode: 'kms' });
  });

  it('local mode needs a 32-byte key and is refused in production', () => {
    expect(loadFieldEncryptionConfig({ KMS_MODE: 'local', LOCAL_KMS_KEY: key })).toMatchObject({
      mode: 'local',
    });
    expect(() => loadFieldEncryptionConfig({ KMS_MODE: 'local' })).toThrow(/LOCAL_KMS_KEY/);
    expect(() =>
      loadFieldEncryptionConfig({ KMS_MODE: 'local', LOCAL_KMS_KEY: 'c2hvcnQ=' }),
    ).toThrow(/LOCAL_KMS_KEY/);
    expect(() =>
      loadFieldEncryptionConfig({ NODE_ENV: 'production', KMS_MODE: 'local', LOCAL_KMS_KEY: key }),
    ).toThrow(/only allowed when NODE_ENV is development or test/);
  });
});

describe('FieldEncryptionModule', () => {
  it('provides FieldEncryption with the key wrapper picked from the settings', async () => {
    const saved = {
      KMS_MODE: process.env['KMS_MODE'],
      LOCAL_KMS_KEY: process.env['LOCAL_KMS_KEY'],
    };
    process.env['KMS_MODE'] = 'local';
    process.env['LOCAL_KMS_KEY'] = localKey.toString('base64');
    try {
      const moduleRef = await Test.createTestingModule({
        imports: [FieldEncryptionModule],
      }).compile();
      const fe = moduleRef.get(FieldEncryption);
      await expect(fe.decrypt(ctx(), await fe.encrypt(ctx(), SSN))).resolves.toBe(SSN);
      // Same local key, so a value from the module opens with a directly built helper too.
      await expect(local().decrypt(ctx(), await fe.encrypt(ctx(), SSN))).resolves.toBe(SSN);
      await moduleRef.close();
    } finally {
      for (const [k, v] of Object.entries(saved)) {
        if (v === undefined) delete process.env[k];
        else process.env[k] = v;
      }
    }
  });
});
