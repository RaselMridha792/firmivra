// The firm's logo (R28). The firm routes name no record (the firm is the caller's, from
// TenantGuard), so they need no case; the logo of firm A is never served for firm B's slug nor
// replaced by firm B's staff in test/e2e/logo.e2e.test.ts.
import type { CaseModule } from '../world.js';

export const excluded: CaseModule['excluded'] = {
  'GET /api/v1/portal/:firmSlug/logo':
    "Public: the firm's logo for its portal, shell, wizard and emails; one firm's slug only ever reaches that firm's file",
};
