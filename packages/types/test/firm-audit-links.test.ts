import { it, expect } from 'vitest';
import { ListFirmAuditLogsQuery } from '../src/firm-audit.js';
import { FirmExternalLinkPatch } from '../src/firm-external-links.js';
it('rejects injected tenant ids and empty resource edits', () => {
  expect(ListFirmAuditLogsQuery.safeParse({ businessId: 'forged' }).success).toBe(false);
  expect(FirmExternalLinkPatch.safeParse({}).success).toBe(false);
});
