import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { DecryptCommand, GenerateDataKeyCommand, type KMSClient } from '@aws-sdk/client-kms';

/** Why a value could not be encrypted or decrypted. Messages never hold a value or key. */
export type FieldEncryptionErrorCode =
  | 'KEY_NOT_PROVISIONED'
  | 'DECRYPTION_FAILED'
  | 'UNSUPPORTED_FORMAT'
  | 'WRONG_MODE'
  | 'INVALID_CONTEXT';

export class FieldEncryptionError extends Error {
  constructor(
    readonly code: FieldEncryptionErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'FieldEncryptionError';
  }
}

/** A fresh AES-256 data key: the plain key (used once, then zeroed) and its wrapped form. */
export interface DataKey {
  plaintext: Buffer;
  wrapped: Buffer;
}

/**
 * Wraps and unwraps data keys with the firm's key: AWS KMS in AWS, LOCAL_KMS_KEY locally. The
 * firm's id is the encryption context, so a key wrapped for one firm never unwraps for another.
 */
export interface KeyWrapper {
  readonly mode: 'local' | 'kms';
  generate(businessId: string, kmsKeyId: string | null): Promise<DataKey>;
  unwrap(businessId: string, kmsKeyId: string | null, wrapped: Buffer): Promise<Buffer>;
}

const IV = 12;
const TAG = 16;

/** AES-256-GCM: iv | tag | ciphertext. */
export function seal(key: Buffer, plaintext: Buffer, aad: Buffer): Buffer {
  const iv = randomBytes(IV);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(aad);
  const body = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), body]);
}

/** Throws DECRYPTION_FAILED on any change to the data, the key or the AAD. */
export function open(key: Buffer, sealed: Buffer, aad: Buffer): Buffer {
  if (sealed.length < IV + TAG) {
    throw new FieldEncryptionError('DECRYPTION_FAILED', 'The encrypted value cannot be read');
  }
  try {
    const decipher = createDecipheriv('aes-256-gcm', key, sealed.subarray(0, IV));
    decipher.setAAD(aad);
    decipher.setAuthTag(sealed.subarray(IV, IV + TAG));
    return Buffer.concat([decipher.update(sealed.subarray(IV + TAG)), decipher.final()]);
  } catch {
    throw new FieldEncryptionError('DECRYPTION_FAILED', 'The encrypted value cannot be read');
  }
}

/** KMS_MODE=local: the same envelope as AWS, with LOCAL_KMS_KEY standing in for the firm's key. */
export class LocalKeyWrapper implements KeyWrapper {
  readonly mode = 'local' as const;
  constructor(private readonly localKey: Buffer) {}

  private context(businessId: string) {
    return Buffer.from(`firmivra-local-kms:${businessId}`);
  }

  async generate(businessId: string): Promise<DataKey> {
    const plaintext = randomBytes(32);
    return { plaintext, wrapped: seal(this.localKey, plaintext, this.context(businessId)) };
  }

  async unwrap(businessId: string, _kmsKeyId: string | null, wrapped: Buffer): Promise<Buffer> {
    return open(this.localKey, wrapped, this.context(businessId));
  }
}

/** KMS_MODE=kms: the firm's own KMS key (businesses.kms_key_id). */
export class AwsKmsKeyWrapper implements KeyWrapper {
  readonly mode = 'kms' as const;
  constructor(private readonly kms: Pick<KMSClient, 'send'>) {}

  private keyId(kmsKeyId: string | null): string {
    if (!kmsKeyId) {
      throw new FieldEncryptionError(
        'KEY_NOT_PROVISIONED',
        'This business has no encryption key yet',
      );
    }
    return kmsKeyId;
  }

  async generate(businessId: string, kmsKeyId: string | null): Promise<DataKey> {
    const out = await this.kms.send(
      new GenerateDataKeyCommand({
        KeyId: this.keyId(kmsKeyId),
        KeySpec: 'AES_256',
        EncryptionContext: { businessId },
      }),
    );
    if (!out.Plaintext || !out.CiphertextBlob) {
      throw new FieldEncryptionError('DECRYPTION_FAILED', 'KMS returned no data key');
    }
    return { plaintext: Buffer.from(out.Plaintext), wrapped: Buffer.from(out.CiphertextBlob) };
  }

  async unwrap(businessId: string, kmsKeyId: string | null, wrapped: Buffer): Promise<Buffer> {
    const keyId = this.keyId(kmsKeyId);
    try {
      // KeyId pins the firm's key: KMS refuses a blob wrapped by any other key.
      const out = await this.kms.send(
        new DecryptCommand({
          KeyId: keyId,
          CiphertextBlob: wrapped,
          EncryptionContext: { businessId },
        }),
      );
      if (!out.Plaintext) throw new Error('no plaintext');
      return Buffer.from(out.Plaintext);
    } catch {
      throw new FieldEncryptionError('DECRYPTION_FAILED', 'The encrypted value cannot be read');
    }
  }
}
