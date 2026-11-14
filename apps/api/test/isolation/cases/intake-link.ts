// A lead's secure intake link (R55, Intake Forms Review Two ACCESS-01): the form a firm emailed a
// lead, filled on its portal site signed out. Every route is public, so the suite's firm and portal
// sweeps don't apply; the walls are the firm from the slug, the intake from the emailed token's
// hash at that firm, and then this browser's HttpOnly cookie (fv_il_{slug}: sealed by the API,
// binding the firm, the intake and the token's hash, checked against the intake on every call).
// test/e2e/intake-link.e2e.test.ts checks them: another firm's slug, a made-up, replaced or
// expired token, and a missing, made-up or other firm's cookie are each 410 LINK_INVALID.
import type { CaseModule } from '../world.js';

const LINK =
  "Public, signed out: acts only on the intake named by this browser's sealed link cookie at this " +
  "firm, while its token is the intake's live one; no cookie, another firm's or a replaced link's " +
  'is 410 LINK_INVALID (intake-link e2e)';
const BASE = '/api/v1/portal/:firmSlug/intake-link';

export const excluded: CaseModule['excluded'] = {
  [`POST ${BASE}/open`]:
    "Public: opens an intake only by the emailed token's hash at this firm; any other token is 410",
  [`GET ${BASE}`]: LINK,
  [`GET ${BASE}/agreements`]: LINK + "; the firm's own agreements for that intake's service",
  [`PUT ${BASE}/steps/:step`]: LINK + '; :step is a step of the form, not a record',
  [`POST ${BASE}/submit`]: LINK,
};
