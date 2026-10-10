// End-to-end over the real database: Firm Sign settings (PrismaSettingsRepository), r0_esign,
// through the real guards, row-level security and database rules. Only the file store and the email
// sender are in memory. Synthetic data only.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ESIGN_DEFAULT_CONSENT_MARKDOWN } from '@firmivra/types';
import { type EsignDbWorld, esignDbWorld, readyDraft } from './esign-db.js';

let w: EsignDbWorld;
const esign = '/api/v1/esign';

beforeAll(async () => {
  w = await esignDbWorld('r13-settings-db', { bareB: true });
});
afterAll(async () => {
  await w?.close();
});

describe('Firm Sign settings on PostgreSQL', () => {
  it('saves the defaults, publishes a consent version and the job title', async () => {
    const owner = w.a.people.owner;
    const put = await w.call('put', `${esign}/settings`, owner, {
      expiryDays: 30,
      emailMessage: 'Fake message',
    });
    expect(put.status).toBe(200);
    const got = await w.call('get', `${esign}/settings`, owner);
    expect(got.body).toMatchObject({ defaults: { expiryDays: 30, emailMessage: 'Fake message' } });
    // Firm B keeps the platform defaults.
    const theirs = await w.call('get', `${esign}/settings`, w.b.people.owner);
    expect(
      (theirs.body as { defaults: { emailMessage: unknown } }).defaults.emailMessage,
    ).toBeNull();

    const published = await w.call('post', `${esign}/settings/consent-versions`, owner, {
      bodyMarkdown: 'Fake consent, second version.',
    });
    expect([published.status, (published.body as { version: number }).version]).toEqual([201, 2]);
    const versions = await w.call('get', `${esign}/settings/consent-versions`, owner);
    const items = (versions.body as { items: { version: number }[] }).items;
    expect(items.map((v) => v.version).sort()).toEqual([1, 2]);

    const me = await w.call('put', `${esign}/me/profile`, w.a.people.staff, {
      jobTitle: 'Fake preparer',
    });
    expect(me.status).toBe(200);
    const stored = await w.inFirm(w.a.id, (tx) =>
      tx.membership.findFirstOrThrow({ where: { userId: w.a.people.staff.id } }),
    );
    expect(stored.jobTitle).toBe('Fake preparer');
  });
});

describe('a firm with no Signing Settings and no consent text (firm B)', () => {
  it('reads the platform defaults and writes nothing', async () => {
    const got = await w.call('get', `${esign}/settings`, w.b.people.owner);
    expect(got.status).toBe(200);
    expect(got.body).toMatchObject({ defaults: { expiryDays: 30 }, consent: null });
    const rows = await w.inFirm(w.b.id, async (tx) => ({
      settings: await tx.esignSettings.count({ where: { businessId: w.b.id } }),
      consents: await tx.esignConsentVersion.count({ where: { businessId: w.b.id } }),
    }));
    expect(rows).toEqual({ settings: 0, consents: 0 });
  });

  it('the first sends publish the default consent once, audited', async () => {
    const owner = w.b.people.owner;
    const drafts = [
      await readyDraft(w, w.b, 'Fake first letter'),
      await readyDraft(w, w.b, 'Fake second letter'),
    ];
    const ready = await w.call('get', `/api/v1/esign/requests/${drafts[0]!.id}/readiness`, owner);
    expect((ready.body as { ready: boolean }).ready).toBe(true);
    // Two sends at once: one version 1, never two.
    const sent = await Promise.all(
      drafts.map((d) =>
        w.call('post', `/api/v1/esign/requests/${d.id}/send`, owner, { confirm: true }),
      ),
    );
    expect(sent.map((r) => r.status)).toEqual([200, 200]);
    const consents = await w.inFirm(w.b.id, (tx) =>
      tx.esignConsentVersion.findMany({ where: { businessId: w.b.id } }),
    );
    expect(consents.map((c) => [c.version, c.bodyMarkdown, c.publishedByUserId])).toEqual([
      [1, ESIGN_DEFAULT_CONSENT_MARKDOWN, null],
    ]);
    const audits = await w.inFirm(w.b.id, (tx) =>
      tx.auditLog.findMany({ where: { businessId: w.b.id, action: 'esign.consent_published' } }),
    );
    expect(audits.map((a) => a.entityId)).toEqual([consents[0]!.id]);
    const got = await w.call('get', `${esign}/settings`, owner);
    expect((got.body as { consent: { version: number } }).consent.version).toBe(1);
    // A third send finds it and publishes nothing.
    const third = await readyDraft(w, w.b, 'Fake third letter');
    await w.call('post', `/api/v1/esign/requests/${third.id}/send`, owner, { confirm: true });
    expect(
      await w.inFirm(w.b.id, (tx) =>
        tx.esignConsentVersion.count({ where: { businessId: w.b.id } }),
      ),
    ).toBe(1);
  });
});
