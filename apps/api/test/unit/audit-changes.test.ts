// Audit Log Review 2, R03: the shared before/after of an audited update (synthetic values only).
import { describe, expect, it } from 'vitest';
import { auditChanges } from '../../src/audit/audit-changes.js';

describe('auditChanges', () => {
  it('lists only what changed, each from → to, with null, "", false and 0 distinct', () => {
    expect(
      auditChanges(
        { name: 'Q1 941', active: true, interval: 0, agency: null, state: 'TX', endOn: null },
        {
          name: 'Q1 941',
          active: false,
          interval: 3,
          agency: '',
          state: 'TX',
          endOn: new Date('2026-12-31T00:00:00.000Z'),
        },
      ),
    ).toEqual({
      fields: ['active', 'agency', 'endOn', 'interval'],
      changes: {
        active: { from: true, to: false },
        agency: { from: null, to: '' },
        endOn: { from: null, to: '2026-12-31T00:00:00.000Z' },
        interval: { from: 0, to: 3 },
      },
    });
  });

  it('compares only the given fields and never the skipped ones', () => {
    const before = { name: 'A', status: 'OPEN', version: 1 };
    const after = { name: 'B', status: 'DONE', version: 2 };
    expect(auditChanges(before, after, { fields: ['name', 'version'], skip: ['version'] })).toEqual(
      {
        fields: ['name'],
        changes: { name: { from: 'A', to: 'B' } },
      },
    );
  });

  it("with text 'all', names what changed and never writes a value", () => {
    expect(
      auditChanges(
        { subject: 'Hi', rateCents: 100 },
        { subject: 'Hello', rateCents: 200 },
        {
          text: 'all',
        },
      ),
    ).toEqual({
      fields: ['rateCents', 'subject'],
      changes: { rateCents: 'changed', subject: 'changed' },
    });
  });

  it('never lists who or when saved it, its version or its etag', () => {
    expect(
      auditChanges(
        { name: 'A', updatedByUserId: 'u-1', updatedAt: new Date(0), version: 1, etag: 'a' },
        { name: 'A', updatedByUserId: 'u-2', updatedAt: new Date(1), version: 2, etag: 'b' },
      ),
    ).toEqual({ fields: [], changes: {} });
  });

  it('writes free text and long values as "changed", never their text', () => {
    const long = 'x'.repeat(300);
    expect(
      auditChanges(
        { description: 'old words', notes: 'a', instructions: 'b', title: 'T', summary: 's' },
        { description: 'new words', notes: 'c', instructions: 'd', title: long, summary: 't' },
        { text: ['summary'] },
      ).changes,
    ).toEqual({
      description: 'changed',
      instructions: 'changed',
      notes: 'changed',
      summary: 'changed',
      title: 'changed',
    });
  });

  it('quote writes a configuration description old to new, but never a note, and never past the cap', () => {
    const long = 'y'.repeat(300);
    const result = auditChanges(
      { description: 'Federal return due', notes: 'a client said' },
      { description: 'Federal return due, extended', notes: 'another note' },
      { quote: ['description'] },
    );
    expect(result.changes).toEqual({
      description: { from: 'Federal return due', to: 'Federal return due, extended' },
      notes: 'changed',
    });
    expect(
      auditChanges({ description: 'a' }, { description: long }, { quote: ['description'] }).changes,
    ).toEqual({ description: 'changed' });
    // A secret under a quoted key is still masked.
    expect(
      auditChanges({ password: 'one' }, { password: 'two' }, { quote: ['password'] }).changes,
    ).toEqual({ password: { from: '[redacted]', to: '[redacted]' } });
  });

  it('masks as decided: secrets never, tax ids to their last 4, bank and card numbers never', () => {
    const { changes } = auditChanges(
      {
        ein: '12-3456789',
        ssn: null,
        password: 'fake-old',
        routingNumber: '011000015',
        bankAccountNumber: '1234567890',
        apiKey: 'fake-key-1',
        einLast4: '6789',
      },
      {
        ein: '98-7654321',
        ssn: '123-45-6789',
        password: 'fake-new',
        routingNumber: '021000021',
        bankAccountNumber: '0987654321',
        apiKey: 'fake-key-2',
        einLast4: '4321',
      },
    );
    expect(changes).toEqual({
      ein: { from: '•••6789', to: '•••4321' },
      ssn: { from: null, to: '•••6789' },
      password: { from: '[redacted]', to: '[redacted]' },
      routingNumber: { from: '[redacted]', to: '[redacted]' },
      bankAccountNumber: { from: '[redacted]', to: '[redacted]' },
      apiKey: { from: '[redacted]', to: '[redacted]' },
      einLast4: { from: '6789', to: '4321' },
    });
    expect(JSON.stringify(changes)).not.toMatch(/fake-|3456789|7654321|011000015|1234567890/);
  });

  it('reads decimals, lists and big numbers plainly; an unchanged list is not a change', () => {
    const decimal = (v: string) => ({ toFixed: () => v, toString: () => v });
    expect(
      auditChanges(
        { rate: decimal('1.50'), states: ['TX', 'CA'], count: 10n },
        { rate: decimal('2.25'), states: ['TX', 'CA'], count: 11n },
      ),
    ).toEqual({
      fields: ['count', 'rate'],
      changes: { count: { from: '10', to: '11' }, rate: { from: '1.50', to: '2.25' } },
    });
  });
});
