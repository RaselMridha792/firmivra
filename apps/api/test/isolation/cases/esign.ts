// Firm Sign (R13). Every route with a record id is behind the esign module, which is off in
// every firm until r0_esign adds its tables; real cases replace these then.
import type { CaseModule } from '../world.js';

const OFF = 'behind the esign module, off everywhere until r0_esign (#156)';

export const moduleOff: CaseModule['moduleOff'] = {
  'GET /api/v1/esign/requests/:id': OFF,
  'PATCH /api/v1/esign/requests/:id': OFF,
  'DELETE /api/v1/esign/requests/:id': OFF,
  'PUT /api/v1/esign/requests/:id/page-plan': OFF,
  'PUT /api/v1/esign/requests/:id/recipients': OFF,
  'PUT /api/v1/esign/requests/:id/fields': OFF,
  'GET /api/v1/esign/requests/:id/merge-values': OFF,
  'GET /api/v1/esign/requests/:id/readiness': OFF,
  'GET /api/v1/esign/requests/:id/events': OFF,
  'POST /api/v1/esign/requests/:id/send': OFF,
  'POST /api/v1/esign/requests/:id/documents/uploads': OFF,
  'POST /api/v1/esign/requests/:id/documents/uploads/confirm': OFF,
  'DELETE /api/v1/esign/requests/:id/documents/:documentId': OFF,
  'POST /api/v1/esign/requests/:id/documents/from-vault': OFF,
  'GET /api/v1/esign/requests/:id/documents/:documentId/content': OFF,
};

// The signer routes are public: no staff or client session and no record id in the URL. The firm
// comes from the slug and the recipient from the sealed fv_sign_{slug} cookie, bound to that slug
// (other firms' tokens and cookies: test/unit/esign-signer.test.ts).
const SIGNER =
  'Public Firm Sign signer route: firm from the slug, recipient from the sealed slug-bound cookie';

export const excluded: CaseModule['excluded'] = {
  'POST /api/v1/portal/:firmSlug/sign/session': SIGNER,
  'GET /api/v1/portal/:firmSlug/sign/state': SIGNER,
  'POST /api/v1/portal/:firmSlug/sign/code/send': SIGNER,
  'POST /api/v1/portal/:firmSlug/sign/code/verify': SIGNER,
  'POST /api/v1/portal/:firmSlug/sign/access-code': SIGNER,
  'GET /api/v1/portal/:firmSlug/sign/consent': SIGNER,
  'POST /api/v1/portal/:firmSlug/sign/consent': SIGNER,
};
