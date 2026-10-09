// R13 step 9, Signing Settings: the defaults, consent versions and the caller's job title, on the
// in-memory ports (esign-fakes.ts). Owner and Admin change them; Staff, a Manager and a Viewer
// only read (403 FORBIDDEN); each firm has its own. Synthetic data only.
import { createHash } from 'node:crypto';
import { HttpException } from '@nestjs/common';
import { beforeEach, describe, expect, it } from 'vitest';
import { EsignConsentVersion, EsignConsentVersionList, EsignSettings } from '@firmivra/types';
import type { EsignActor } from '../../src/esign/requests/requests.service.js';
import { EsignSettingsService } from '../../src/esign/settings/settings.service.js';
import {
  ESIGN_TEST_DEFAULTS,
  esignWorld,
  type EsignWorld,
  InMemorySettingsRepository,
  InMemorySignerRepository,
} from './esign-fakes.js';

let w: EsignWorld;
let signers: InMemorySignerRepository;
let settings: InMemorySettingsRepository;
let svc: EsignSettingsService;
let owner: EsignActor;
let admin: EsignActor;
let staff: EsignActor;
let manager: EsignActor;
let viewer: EsignActor;
let ownerB: EsignActor;
const TEXT = 'I agree to sign these documents electronically. (Fake consent text.)';

beforeEach(() => {
  w = esignWorld();
  signers = new InMemorySignerRepository(w.repo);
  settings = new InMemorySettingsRepository(w.repo, signers);
  svc = new EsignSettingsService(settings, w.directory, w.audit);
  owner = { userId: w.users.ownerA, role: 'OWNER' };
  admin = { userId: w.users.adminA, role: 'ADMIN' };
  staff = { userId: w.users.staffA, role: 'STAFF' };
  manager = { userId: w.users.managerA, role: 'MANAGER' };
  viewer = { userId: w.users.staffA2, role: 'VIEWER' };
  ownerB = { userId: w.users.ownerB, role: 'OWNER' };
});

async function refused(work: Promise<unknown>): Promise<[number, string]> {
  try {
    await work;
  } catch (error) {
    if (!(error instanceof HttpException)) throw error;
    return [error.getStatus(), (error.getResponse() as { code: string }).code];
  }
  throw new Error('expected a refusal');
}

describe('Signing Settings', () => {
  it('reads the defaults, no consent yet and canEdit by role', async () => {
    const got = EsignSettings.parse(await svc.get(w.a, owner));
    expect(got).toEqual({
      defaults: ESIGN_TEST_DEFAULTS,
      consent: null,
      canEdit: true,
      myJobTitle: null,
    });
    expect((await svc.get(w.a, admin)).canEdit).toBe(true);
    for (const who of [staff, manager, viewer])
      expect((await svc.get(w.a, who)).canEdit).toBe(false);
  });

  it('lets Owner and Admin change only the keys sent, and new requests take them', async () => {
    const got = await svc.update(w.a, owner, { expiryDays: 14, emailMessage: null });
    expect(got.defaults).toEqual({ ...ESIGN_TEST_DEFAULTS, expiryDays: 14, emailMessage: null });
    await svc.update(w.a, admin, { requireApproval: true });
    expect(await w.repo.defaults(w.a)).toMatchObject({ expiryDays: 14, requireApproval: true });
    // Firm B's defaults are its own.
    expect((await svc.get(w.b, ownerB)).defaults).toEqual(ESIGN_TEST_DEFAULTS);
    const audited = w.audit.entries.filter((e) => e.action === 'esign.settings_updated');
    expect(audited.map((e) => e.metadata)).toEqual([
      { changed: ['expiryDays', 'emailMessage'] },
      { changed: ['requireApproval'] },
    ]);
    expect(JSON.stringify(audited)).not.toContain('Please');
  });

  it('refuses Staff, a Manager and a Viewer (403 FORBIDDEN), changing nothing', async () => {
    for (const who of [staff, manager, viewer]) {
      expect(await refused(svc.update(w.a, who, { expiryDays: 5 }))).toEqual([403, 'FORBIDDEN']);
      expect(await refused(svc.publishConsent(w.a, who, TEXT))).toEqual([403, 'FORBIDDEN']);
    }
    expect(await w.repo.defaults(w.a)).toEqual(ESIGN_TEST_DEFAULTS);
    expect((await svc.consentVersions(w.a)).items).toEqual([]);
    expect(w.audit.entries).toEqual([]);
  });
});

describe('consent versions', () => {
  it('publishes numbered versions, newest first, with the text hash and who published', async () => {
    const v1 = EsignConsentVersion.parse(await svc.publishConsent(w.a, owner, TEXT));
    const v2 = await svc.publishConsent(w.a, admin, `${TEXT} Version two.`);
    expect([v1.version, v2.version]).toEqual([1, 2]);
    expect(v1.sha256).toBe(createHash('sha256').update(TEXT).digest('hex'));
    expect(v1.publishedBy).toEqual({ userId: w.users.ownerA, name: 'owner-a' });
    const list = EsignConsentVersionList.parse(await svc.consentVersions(w.a));
    expect(list.items.map((v) => v.version)).toEqual([2, 1]);
    expect((await svc.get(w.a, staff)).consent?.id).toBe(v2.id);
    // The audit row has the ids, the number and the hash, never the text.
    const row = w.audit.entries.find((e) => e.entity.id === v1.id);
    expect(row).toMatchObject({ action: 'esign.consent_published', metadata: { version: 1 } });
    expect(JSON.stringify(w.audit.entries)).not.toContain('electronically');
  });

  it('is what signers accept from then on, and readiness sees it', async () => {
    expect(await w.repo.consentPublished(w.b)).toBe(true); // the world's flag
    w.repo.consent.delete(w.b);
    const v = await svc.publishConsent(w.b, ownerB, TEXT);
    expect(await w.repo.consentPublished(w.b)).toBe(true);
    expect(await signers.currentConsent(w.b)).toEqual({
      id: v.id,
      version: 1,
      bodyMarkdown: TEXT,
    });
    // Firm A has none: firm B's version is its own.
    expect(await signers.currentConsent(w.a)).toBeNull();
    expect((await svc.consentVersions(w.a)).items).toEqual([]);
  });

  it('a version whose publisher left shows no name', async () => {
    const v = await svc.publishConsent(w.a, owner, TEXT);
    w.directory.members.of(w.a).delete(w.users.ownerA);
    expect((await svc.consentVersions(w.a)).items[0]).toMatchObject({
      id: v.id,
      publishedBy: null,
    });
  });
});

describe('my job title', () => {
  it('any member sets their own, and clears it', async () => {
    for (const who of [staff, viewer, owner]) {
      const got = await svc.updateProfile(w.a, who, `Fake title ${who.role}`);
      expect(got.myJobTitle).toBe(`Fake title ${who.role}`);
    }
    expect((await svc.get(w.a, staff)).myJobTitle).toBe('Fake title STAFF');
    expect((await svc.updateProfile(w.a, staff, null)).myJobTitle).toBeNull();
    // Another member's and another firm's titles are their own.
    expect((await svc.get(w.a, admin)).myJobTitle).toBeNull();
    expect((await svc.get(w.b, ownerB)).myJobTitle).toBeNull();
    expect(w.audit.entries[0]).toEqual({
      action: 'esign.profile_updated',
      entity: { type: 'user', id: w.users.staffA },
      metadata: {},
    });
    expect(JSON.stringify(w.audit.entries)).not.toContain('Fake title');
  });
});
