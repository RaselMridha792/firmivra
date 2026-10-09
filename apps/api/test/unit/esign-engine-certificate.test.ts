// Unit tests for R18 step 8, the completion certificate and audit trail: what it says (request,
// signers, auth methods, consent version, times, IP and user agent, events, both SHA-256 values),
// that it says nothing else, that the same input gives the same bytes, and paging; plus the
// PDF engine and its module token.
import { Test } from '@nestjs/testing';
import { PDFDocument, PDFPage } from 'pdf-lib';
import { describe, expect, it, vi } from 'vitest';
import { ConfigModule } from '../../src/config/config.module.js';
import { loadEnv } from '../../src/config/env.js';
import { certificate, certificateBlocks } from '../../src/esign/engine/certificate.js';
import { EsignEngineModule } from '../../src/esign/engine/engine.module.js';
import { type CertificateInput, PDF_ENGINE } from '../../src/esign/engine/engine.types.js';
import { pdfEngine, sha256Hex } from '../../src/esign/engine/pdf-engine.js';

const input = (events = 3): CertificateInput => ({
  request: {
    id: '0b6f7a52-4c1e-4d5c-9a7e-3f1d2c3b4a59',
    title: 'Engagement letter 2026 (fake)',
    firmName: 'Fake Firm LLC',
    sentAt: new Date('2026-10-01T14:00:00Z'),
    completedAt: new Date('2026-10-02T16:30:00Z'),
  },
  signers: [
    {
      name: 'Fake Client',
      email: 'client@example.test',
      role: 'CLIENT',
      authMethod: 'EMAIL_CODE',
      consentVersion: 1,
      viewedAt: new Date('2026-10-02T16:00:00Z'),
      signedAt: new Date('2026-10-02T16:30:00Z'),
      ip: '203.0.113.7',
      userAgent: 'Mozilla/5.0 (FakeOS) FakeBrowser/1.0',
    },
  ],
  events: Array.from({ length: events }, (_, i) => ({
    at: new Date(Date.UTC(2026, 9, 1, 14, i)),
    type: i === 0 ? ('SENT' as const) : ('AUTH_PASSED' as const),
    actor: i === 0 ? 'Fake Staff' : 'Fake Client',
    authMethod: i === 0 ? null : ('EMAIL_CODE' as const),
  })),
  originalSha256: 'a'.repeat(64),
  finalSha256: 'b'.repeat(64),
  timeZone: 'America/New_York',
});

describe('certificate', () => {
  it('lists the request, signers, events and hashes', () => {
    const blocks = certificateBlocks(input());
    const rows = Object.fromEntries(
      blocks.flatMap((b) => (b.kind === 'row' ? [[b.label, b.value]] : [])),
    );
    expect(rows).toMatchObject({
      Document: 'Engagement letter 2026 (fake)',
      'Request ID': '0b6f7a52-4c1e-4d5c-9a7e-3f1d2c3b4a59',
      Firm: 'Fake Firm LLC',
      Sent: 'Oct 1, 2026, 10:00:00 AM EDT',
      'Original SHA-256': 'a'.repeat(64),
      'Signed PDF SHA-256': 'b'.repeat(64),
      Name: 'Fake Client',
      Email: 'client@example.test',
      Role: 'Client',
      'Verified by': 'Email code',
      'E-sign consent': 'Version 1',
      Signed: 'Oct 2, 2026, 12:30:00 PM EDT',
      'IP address': '203.0.113.7',
      'User agent': 'Mozilla/5.0 (FakeOS) FakeBrowser/1.0',
    });
    const events = blocks.filter((b) => b.kind === 'columns').map((b) => b.cells);
    expect(events).toEqual([
      ['Time', 'Event', 'By', 'Verified by'],
      ['Oct 1, 2026, 10:00:00 AM EDT', 'Sent', 'Fake Staff', ''],
      ['Oct 1, 2026, 10:01:00 AM EDT', 'Identity check passed', 'Fake Client', 'Email code'],
      ['Oct 1, 2026, 10:02:00 AM EDT', 'Identity check passed', 'Fake Client', 'Email code'],
    ]);
  });

  it('prints only what its input holds: extra properties never reach it', () => {
    const leaky = {
      ...input(),
      fields: [{ value: 'SECRET-VALUE' }],
      content: 'SECRET-CONTENT',
      signers: input().signers.map((s) => ({ ...s, answers: 'SECRET-ANSWER' })),
    } as unknown as CertificateInput;
    const printed = JSON.stringify(certificateBlocks(leaky));
    for (const secret of ['SECRET-VALUE', 'SECRET-CONTENT', 'SECRET-ANSWER']) {
      expect(printed).not.toContain(secret);
    }
  });

  it('prints every wrapped line of a long audit-trail cell', async () => {
    const actor = 'Christopher Alexander Montgomery-Smith Jr. (fake)';
    const long = input();
    long.events[1]!.actor = actor;
    const drawn: string[] = [];
    const spy = vi.spyOn(PDFPage.prototype, 'drawText').mockImplementation(function (
      this: PDFPage,
      text: string,
    ) {
      drawn.push(text);
    });
    try {
      await certificate(long);
    } finally {
      spy.mockRestore();
    }
    const words = actor.split(' ');
    for (const word of words) expect(drawn.some((line) => line.includes(word))).toBe(true);
    expect(drawn.filter((line) => actor.includes(line) && line.length > 3).length).toBeGreaterThan(
      1,
    );
  });

  it('lists events oldest first and falls back to UTC for an unknown time zone', () => {
    const shuffled = { ...input(), timeZone: 'Not/AZone' };
    shuffled.events = [...shuffled.events].reverse();
    const blocks = certificateBlocks(shuffled);
    const times = blocks.flatMap((b) => (b.kind === 'columns' ? [b.cells[0]] : [])).slice(1);
    expect(times).toEqual([
      'Oct 1, 2026, 2:00:00 PM UTC',
      'Oct 1, 2026, 2:01:00 PM UTC',
      'Oct 1, 2026, 2:02:00 PM UTC',
    ]);
  });

  it('gives the same bytes for the same input', async () => {
    const a = await certificate(input());
    const b = await certificate(input());
    expect(sha256Hex(a)).toBe(sha256Hex(b));
    const doc = await PDFDocument.load(a);
    expect(doc.getTitle()).toBe('Certificate of completion: Engagement letter 2026 (fake)');
    expect(doc.getCreationDate()).toEqual(new Date('2026-10-02T16:30:00Z'));
  });

  it('adds pages for a long audit trail', async () => {
    expect((await PDFDocument.load(await certificate(input(3)))).getPageCount()).toBe(1);
    expect((await PDFDocument.load(await certificate(input(150)))).getPageCount()).toBeGreaterThan(
      2,
    );
  });
});

describe('the PDF engine', () => {
  it('is what the module provides as PDF_ENGINE', async () => {
    process.env.S3_DOCUMENTS_BUCKET ??= 'fake-bucket';
    const moduleRef = await Test.createTestingModule({
      imports: [ConfigModule.forRoot(loadEnv()), EsignEngineModule],
    }).compile();
    expect(moduleRef.get(PDF_ENGINE)).toBe(pdfEngine);
    await moduleRef.close();
  });

  it('hashes files stably', () => {
    const bytes = new TextEncoder().encode('fake');
    expect(sha256Hex(bytes)).toBe(
      'b5d54c39e66671c9731b9f471e585d8262cd4f54963f0c93082d8dcf334d4c78',
    );
  });
});
