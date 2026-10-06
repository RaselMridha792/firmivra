import { it, expect } from 'vitest';
import { approvedResourceUrl } from '../../src/external-links/external-links.service.js';
import { safeAuditMetadata } from '../../src/audit-viewer/audit-viewer.service.js';
import { PendingSupportAccess } from '../../src/audit-viewer/support.ports.js';
it('restricts resources to exact HTTPS government hosts without data or redirect parameters', () => {
  expect(approvedResourceUrl('https://www.irs.gov/ein')).toBe('https://www.irs.gov/ein');
  for (const url of [
    'http://www.irs.gov/ein',
    'https://www.irs.gov.evil.test/ein',
    'https://user:pass@www.irs.gov/ein',
    'https://www.irs.gov/ein?clientId=synthetic',
    'https://www.irs.gov/ein#token',
    'https://www.irs.gov:444/ein',
  ])
    expect(() => approvedResourceUrl(url)).toThrow();
});
it('drops private/unknown/nested audit payloads, allowing only typed safe fields', () => {
  expect(
    safeAuditMetadata({
      count: 3,
      version: 2,
      newRole: 'STAFF',
      includeArchived: false,
      token: 'synthetic-secret',
      body: 'private',
      status: 'private-status',
      nested: { ssn: 'synthetic-secret' },
    }),
  ).toEqual({ count: 3, version: 2, newRole: 'STAFF', includeArchived: false });
  expect(safeAuditMetadata(null)).toEqual({});
});
it('refuses support reads without the Rasel authorization adapter', async () => {
  await expect(new PendingSupportAccess().withFirm()).rejects.toMatchObject({ status: 503 });
});
