// Company Profile & Branding (R55). The firm routes name no record (the firm is the caller's,
// from TenantGuard; the asset kind is a code), so they need no case; firm A's branding is never
// read, changed, reset or served for firm B in test/e2e/branding.e2e.test.ts.
import type { CaseModule } from '../world.js';

export const excluded: CaseModule['excluded'] = {
  'GET /api/v1/portal/:firmSlug/branding/:asset':
    "Public: the firm's favicon, login background and email and portal logos; one firm's slug only ever reaches that firm's files",
};
