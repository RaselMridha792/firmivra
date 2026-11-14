// Begin Online (R11, contract B): a signed-out visitor asks a firm for a service on its portal
// site. Every route is public, so the suite's firm and portal sweeps don't apply; the walls are the
// firm from the slug and the draft from this browser's HttpOnly cookie for the service
// (fv_bo_{slug}_{path}: sealed by the API, binding the firm, the lead and the form, read only on
// that firm's site). test/e2e/begin-online.e2e.test.ts checks them: another firm's slug, another
// service's path, a missing or made-up cookie and another draft's file are each 404, and another
// draft's upload ticket is 410.
import type { CaseModule } from '../world.js';

const DRAFT =
  'Public, signed out: acts only on the draft named by its sealed HttpOnly cookie for this ' +
  "service at this firm; no cookie, another firm's or service's cookie or a made-up one is 404 " +
  '(begin-online e2e)';
const BASE = '/api/v1/portal/:firmSlug/begin';

export const excluded: CaseModule['excluded'] = {
  [`GET ${BASE}/forms`]:
    "Public: the forms of the firm's live Begin Online services, from the slug; no client data",
  [`GET ${BASE}/forms/:formPath`]:
    "Public: the published form of the firm's live service of that kind; no client data",
  [`POST ${BASE}/:formPath/draft`]:
    'Public: starts a new draft at the firm of the slug and sets its cookie; reads no record',
  [`GET ${BASE}/:formPath/draft`]: DRAFT,
  [`PUT ${BASE}/:formPath/draft/steps/:step`]:
    DRAFT + '; :step is a step of the form, not a record',
  [`GET ${BASE}/:formPath/draft/uploads`]: DRAFT,
  [`POST ${BASE}/:formPath/draft/uploads`]: DRAFT,
  [`POST ${BASE}/:formPath/draft/uploads/confirm`]:
    DRAFT + '; the upload token is sealed for that draft (another draft is 410)',
  [`DELETE ${BASE}/:formPath/draft/uploads/:uploadId`]: DRAFT + "; another draft's file is 404",
  [`POST ${BASE}/:formPath/draft/submit`]: DRAFT,
  [`POST ${BASE}/resume-link`]:
    'Public: always { received: true }; emails links only to the address of the firm’s own drafts',
  // INTAKE-ACCESS-02 (intake-share e2e): a firm's shared form, for anyone with its link.
  [`GET ${BASE}/share/:token`]:
    "Public: the published form whose share link's hash is the token's at this firm; a link turned off, another firm's or a made-up one is 410",
  [`POST ${BASE}/share/:token/draft`]:
    'Public: starts a new draft of that shared form at the firm of the slug and sets its cookie; reads no record',
  [`GET ${BASE}/:formPath/draft/agreements`]:
    DRAFT + "; the firm's current agreements for that draft's own service",
  [`POST ${BASE}/resume`]:
    "Public: opens a draft only by the emailed token's hash at this firm; any other token is 410",
};
