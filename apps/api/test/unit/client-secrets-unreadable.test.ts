// readDateOfBirth with a stubbed field-encryption helper: a date of birth that can't be read is
// logged with the client's id and the error code only, never the value or the error's message
// (hard rule 4). The e2e tests run with the logger off, so they can't see what is logged.
import { Logger } from '@nestjs/common';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readDateOfBirth } from '../../src/clients/client-secrets.js';
import {
  type FieldEncryption,
  FieldEncryptionError,
} from '../../src/field-encryption/field-encryption.service.js';

const businessId = '0199b6a3-0000-7000-8000-000000000042';
const clientId = '0199b6a4-0000-7000-8000-000000000042';
/** Synthetic: the stored bytes and details an error message might carry. */
const dobEnc = new Uint8Array(Buffer.from('sealed-1984-02-29'));
const details = ['1984-02-29', 'sealed', 'arn:aws:kms', 'secret-detail'];

const helper = (decrypt: () => Promise<string>) => ({ decrypt }) as unknown as FieldEncryption;

/** Nothing reaches the console; each test reads what would have been logged. */
const spyOnWarn = () => vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
let warn: ReturnType<typeof spyOnWarn>;
beforeEach(() => {
  warn = spyOnWarn();
});
afterEach(() => {
  warn.mockRestore();
});

describe('readDateOfBirth: a date of birth that cannot be read', () => {
  it('logs the client id and the error code only, and answers it as unavailable', async () => {
    const codes = ['DECRYPTION_FAILED', 'KEY_NOT_PROVISIONED', 'KMS_UNAVAILABLE'] as const;
    for (const code of codes) {
      warn.mockClear();
      const fe = helper(() =>
        Promise.reject(
          new FieldEncryptionError(code, 'secret-detail 1984-02-29 arn:aws:kms:us-east-1:1:key/x'),
        ),
      );
      await expect(readDateOfBirth(fe, businessId, clientId, dobEnc)).resolves.toEqual({
        dateOfBirth: null,
        dateOfBirthUnavailable: true,
      });
      expect(warn.mock.calls, code).toEqual([
        [`Date of birth not readable for client ${clientId}: ${code}`],
      ]);
      const text = JSON.stringify(warn.mock.calls);
      for (const detail of details) expect(text, code).not.toContain(detail);
    }
  });

  it('rethrows any other error (a bug, so a 500) and logs nothing', async () => {
    const bug = new TypeError('not a field-encryption error');
    const fe = helper(() => Promise.reject(bug));
    await expect(readDateOfBirth(fe, businessId, clientId, dobEnc)).rejects.toBe(bug);
    expect(warn).not.toHaveBeenCalled();
  });

  it('reads a readable value, and nothing on file, without a warning', async () => {
    const fe = helper(() => Promise.resolve('1984-02-29'));
    await expect(readDateOfBirth(fe, businessId, clientId, dobEnc)).resolves.toEqual({
      dateOfBirth: '1984-02-29',
      dateOfBirthUnavailable: false,
    });
    await expect(readDateOfBirth(fe, businessId, clientId, null)).resolves.toEqual({
      dateOfBirth: null,
      dateOfBirthUnavailable: false,
    });
    expect(warn).not.toHaveBeenCalled();
  });
});
