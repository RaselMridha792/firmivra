// Audit Log Review 2, M03: what an audit row may hold of a value. Secrets are never written, tax
// ids keep their last 4, flags and everything else stay as they are (synthetic values only).
import { describe, expect, it, vi } from 'vitest';
import type { Database } from '@firmivra/db';
import { AuditService } from '../../src/audit/audit.service.js';
import {
  isFreeTextKey,
  isSecretKey,
  isTaxIdKey,
  lastFour,
  REDACTED,
  redactMetadata,
} from '../../src/audit/audit-values.js';

describe('which keys are secrets, tax ids or free text', () => {
  it('judges a key by its last word', () => {
    for (const key of [
      'password',
      'newPassword',
      'temporary_password',
      'mfaCode',
      'resetCode',
      'verification_code',
      'recoveryCodes',
      'accessToken',
      'refreshToken',
      'uploadToken',
      'apiKey',
      'api_key',
      'privateKey',
      'secretAccessKey',
      'clientSecret',
      'signingSecret',
      'cardNumber',
      'bankAccountNumber',
      'routingNumber',
      'iban',
      'cvc',
      'pin',
      'otp',
    ]) {
      expect([key, isSecretKey(key)]).toEqual([key, true]);
    }
    for (const key of [
      'passwordChangedAt',
      'tokenId',
      'tokenHash',
      'code',
      'postalCode',
      'errorCode',
      'planCode',
      'promoCode',
      'idempotencyKey',
      's3Key',
      'logoKey',
      'invoiceNumber',
      'clientNumber',
      'referenceNumber',
      'confirmationNumber',
      'pinned',
      'keyCount',
    ]) {
      expect([key, isSecretKey(key)]).toEqual([key, false]);
    }
  });

  it('finds tax ids, never their last-4 or status fields', () => {
    for (const key of ['ssn', 'ein', 'itin', 'tin', 'taxId', 'tax_id', 'spouseSsn', 'clientEIN'])
      expect([key, isTaxIdKey(key)]).toEqual([key, true]);
    for (const key of ['einLast4', 'einStatus', 'ssnLast4', 'taxYear', 'taxIdType'])
      expect([key, isTaxIdKey(key)]).toEqual([key, false]);
  });

  it('finds free text', () => {
    for (const key of [
      'notes',
      'description',
      'messageBody',
      'internalNote',
      'details',
      'notApplicableReason',
    ])
      expect([key, isFreeTextKey(key)]).toEqual([key, true]);
    for (const key of ['status', 'noteId', 'dueOn', 'name'])
      expect([key, isFreeTextKey(key)]).toEqual([key, false]);
  });

  it('keeps a tax id’s last 4 only', () => {
    expect(lastFour('123-45-6789')).toBe('•••6789');
    expect(lastFour('12-3456789')).toBe('•••6789');
    expect(lastFour(123)).toBe(REDACTED);
  });
});

describe('redactMetadata', () => {
  it('redacts secrets and masks tax ids at any depth, keeping flags, null and everything else', () => {
    expect(
      redactMetadata({
        clientId: 'c-1',
        password: 'fake-pass-1',
        hasPassword: true,
        mfaCode: '123456',
        accessToken: null,
        ssn: '123-45-6789',
        nested: { routingNumber: '011000015', bankAccountNumber: 9876543210, label: 'Checking' },
        list: [{ apiKey: 'fake-key' }, { name: 'x' }],
        changes: {
          ein: { from: '12-3456789', to: '98-7654321' },
          password: { from: 'fake-old', to: 'fake-new' },
          status: { from: 'OPEN', to: 'DONE' },
        },
        fields: ['password', 'ssn'],
      }),
    ).toEqual({
      clientId: 'c-1',
      password: REDACTED,
      hasPassword: true,
      mfaCode: REDACTED,
      accessToken: null,
      ssn: '•••6789',
      nested: { routingNumber: REDACTED, bankAccountNumber: REDACTED, label: 'Checking' },
      list: [{ apiKey: REDACTED }, { name: 'x' }],
      changes: {
        ein: { from: '•••6789', to: '•••4321' },
        password: { from: REDACTED, to: REDACTED },
        status: { from: 'OPEN', to: 'DONE' },
      },
      // Field names are not values.
      fields: ['password', 'ssn'],
    });
  });

  it('is applied to every row AuditService writes', async () => {
    const writes: Record<string, unknown>[] = [];
    const create = vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
      writes.push(data);
    });
    const db = {
      forBusiness: () => ({ auditLog: { create } }),
      forPlatform: () => ({ auditLog: { create } }),
    } as unknown as Database;
    await new AuditService(db).log(
      'fake.updated',
      { type: 'fake' },
      { resetCode: '654321', ein: '12-3456789', changed: true },
      { businessId: null },
    );
    expect(writes[0]?.metadata).toEqual({ resetCode: REDACTED, ein: '•••6789', changed: true });
  });
});
