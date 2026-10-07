import { Inject, Injectable, Module } from '@nestjs/common';
import { KMSClient } from '@aws-sdk/client-kms';
import type { Database } from '@firmivra/db';
import { DATABASE } from '../database/database.module.js';
import { type FieldEncryptionConfig, loadFieldEncryptionConfig } from './config.js';
import {
  AwsKmsKeyWrapper,
  FieldEncryptionError,
  type KeyWrapper,
  LocalKeyWrapper,
  open,
  seal,
} from './key-wrapper.js';

export { FieldEncryptionError, type FieldEncryptionErrorCode } from './key-wrapper.js';

/**
 * Where an encrypted value lives. The ciphertext is bound to all of it: a value copied to
 * another firm, table, record or field does not decrypt. The firm's key is looked up from
 * `businessId`, never passed in, so a caller can't pair one firm's id with another firm's key.
 */
export interface FieldContext {
  businessId: string;
  /** The table, e.g. 'client_profiles'. */
  table: string;
  /** The row the value belongs to, e.g. the client id for client_profiles. */
  recordId: string;
  /** The column, e.g. 'ssn' or 'date_of_birth'. */
  field: string;
}

/** The firm's KMS key id (businesses.kms_key_id), or null when it has none yet. */
export interface FirmKeyIds {
  keyIdOf(businessId: string): Promise<string | null>;
}

/** Nest tokens for the KeyWrapper picked by KMS_MODE and for the firm key lookup. */
export const KEY_WRAPPER = Symbol('KEY_WRAPPER');
export const FIRM_KEY_IDS = Symbol('FIRM_KEY_IDS');

/** Reads the key id in the firm's own scope (business scope sees only its own firm). */
@Injectable()
export class DatabaseFirmKeyIds implements FirmKeyIds {
  constructor(@Inject(DATABASE) private readonly database: Database) {}

  async keyIdOf(businessId: string): Promise<string | null> {
    const firm = await this.database.withScope({ kind: 'business', businessId }, (tx) =>
      tx.business.findUnique({ where: { id: businessId }, select: { kmsKeyId: true } }),
    );
    return firm?.kmsKeyId ?? null;
  }
}

const VERSION = 1;
const MODES = { local: 1, kms: 2 } as const;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const NAME = /^[a-z][a-z0-9_]{0,62}$/;

function checkContext(ctx: FieldContext): void {
  if (
    !UUID.test(ctx.businessId) ||
    !NAME.test(ctx.table) ||
    !UUID.test(ctx.recordId) ||
    !NAME.test(ctx.field)
  ) {
    throw new FieldEncryptionError('INVALID_CONTEXT', 'Invalid field-encryption context');
  }
}

/** Authenticated with the value: the context and the blob's header. */
function aad(ctx: FieldContext, header: Buffer): Buffer {
  return Buffer.concat([
    Buffer.from(
      `firmivra-field:v${VERSION}:${ctx.businessId}:${ctx.table}:${ctx.recordId}:${ctx.field}:`,
    ),
    header,
  ]);
}

/**
 * Encrypts sensitive fields (SSN, EIN, date of birth; R5 reuses it) with the firm's key
 * (CLAUDE.md: per-business KMS keys). Envelope encryption: each value gets a new AES-256 data
 * key from KMS and is sealed with AES-256-GCM. Stored blob (bytea):
 *   version (1) | mode (1: local, 2: kms) | wrapped key length (uint16) | wrapped key | iv | tag | ciphertext
 * Never log a value, a decrypted value or a data key; error messages never hold one.
 */
@Injectable()
export class FieldEncryption {
  constructor(
    @Inject(KEY_WRAPPER) private readonly keys: KeyWrapper,
    @Inject(FIRM_KEY_IDS) private readonly firmKeys: FirmKeyIds,
  ) {}

  /** KMS mode: the firm's key (KEY_NOT_PROVISIONED without one). Local mode needs none. */
  private async keyId(businessId: string): Promise<string | null> {
    return this.keys.mode === 'kms' ? this.firmKeys.keyIdOf(businessId) : null;
  }

  async encrypt(ctx: FieldContext, value: string): Promise<Uint8Array<ArrayBuffer>> {
    checkContext(ctx);
    if (typeof value !== 'string') {
      throw new FieldEncryptionError('INVALID_VALUE', 'Only text can be encrypted');
    }
    const key = await this.keys.generate(ctx.businessId, await this.keyId(ctx.businessId));
    const plain = Buffer.from(value, 'utf8');
    try {
      const header = Buffer.alloc(4);
      header.writeUInt8(VERSION, 0);
      header.writeUInt8(MODES[this.keys.mode], 1);
      header.writeUInt16BE(key.wrapped.length, 2);
      const head = Buffer.concat([header, key.wrapped]);
      const body = seal(key.plaintext, plain, aad(ctx, head));
      return new Uint8Array(Buffer.concat([head, body]));
    } finally {
      key.plaintext.fill(0);
      plain.fill(0);
    }
  }

  async decrypt(ctx: FieldContext, blob: Uint8Array): Promise<string> {
    checkContext(ctx);
    const data = Buffer.from(blob);
    if (data.length < 4 || data.readUInt8(0) !== VERSION) {
      throw new FieldEncryptionError('UNSUPPORTED_FORMAT', 'Unknown encrypted value format');
    }
    if (data.readUInt8(1) !== MODES[this.keys.mode]) {
      throw new FieldEncryptionError(
        'WRONG_MODE',
        `This value was not encrypted with KMS_MODE=${this.keys.mode}`,
      );
    }
    const wrappedEnd = 4 + data.readUInt16BE(2);
    if (data.length < wrappedEnd) {
      throw new FieldEncryptionError('DECRYPTION_FAILED', 'The encrypted value cannot be read');
    }
    const head = data.subarray(0, wrappedEnd);
    const dataKey = await this.keys.unwrap(
      ctx.businessId,
      await this.keyId(ctx.businessId),
      head.subarray(4),
    );
    try {
      const plain = open(dataKey, data.subarray(wrappedEnd), aad(ctx, head));
      try {
        return plain.toString('utf8');
      } finally {
        plain.fill(0);
      }
    } finally {
      dataKey.fill(0);
    }
  }
}

export function createKeyWrapper(config: FieldEncryptionConfig): KeyWrapper {
  return config.mode === 'local'
    ? new LocalKeyWrapper(config.localKey)
    : new AwsKmsKeyWrapper(new KMSClient({}));
}

/** Import where SSNs, EINs, dates of birth or other sensitive fields are read or written. */
@Module({
  providers: [
    // Settings are checked when the app starts, so a bad KMS_MODE never reaches a request.
    { provide: KEY_WRAPPER, useFactory: () => createKeyWrapper(loadFieldEncryptionConfig()) },
    { provide: FIRM_KEY_IDS, useClass: DatabaseFirmKeyIds },
    FieldEncryption,
  ],
  exports: [FieldEncryption],
})
export class FieldEncryptionModule {}
