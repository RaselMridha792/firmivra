// Begin Online (R11): a signed-out visitor asks a firm for a service on its portal site. Every
// route is public, so the suite's firm and portal sweeps don't apply; the walls are the firm from
// the slug and the draft from its HttpOnly cookie (fv_bo_{slug}: a random key whose SHA-256 is
// stored, scoped to that firm's site). test/e2e/begin-online.e2e.test.ts checks them: another
// firm's slug, a missing or made-up cookie and another draft's file are each 404.
import type { CaseModule } from '../world.js';

const PUBLIC_LIST = "Public: the firm's live Begin Online services, from the slug; no client data";
const DRAFT =
  'Public, signed out: acts only on the draft named by its HttpOnly cookie at this firm; ' +
  "no cookie, another firm's slug or a made-up key is 404 (begin-online e2e)";

export const excluded: CaseModule['excluded'] = {
  'GET /api/v1/portal/:firmSlug/begin-online/services': PUBLIC_LIST,
  'GET /api/v1/portal/:firmSlug/begin-online/services/:serviceId/form':
    "Public: the published form of one of this firm's live services; another firm's service is 404",
  'POST /api/v1/portal/:firmSlug/begin-online/drafts':
    'Public: starts a new draft at the firm of the slug and sets its cookie; reads no record',
  'GET /api/v1/portal/:firmSlug/begin-online/drafts/current': DRAFT,
  'PUT /api/v1/portal/:firmSlug/begin-online/drafts/current/steps/:stepKey':
    DRAFT + '; :stepKey is a step of the form, not a record',
  'POST /api/v1/portal/:firmSlug/begin-online/drafts/current/resume-link': DRAFT,
  'POST /api/v1/portal/:firmSlug/begin-online/drafts/resume':
    "Public: opens a draft only by the emailed token's hash at this firm; any other token is 410",
  'POST /api/v1/portal/:firmSlug/begin-online/drafts/current/submit': DRAFT,
  'POST /api/v1/portal/:firmSlug/begin-online/drafts/current/uploads': DRAFT,
  'POST /api/v1/portal/:firmSlug/begin-online/drafts/current/uploads/confirm':
    DRAFT + '; the upload token is sealed for that draft',
  'DELETE /api/v1/portal/:firmSlug/begin-online/drafts/current/uploads/:id':
    DRAFT + "; another draft's file is 404",
};
