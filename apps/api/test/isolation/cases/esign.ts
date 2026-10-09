// Firm Sign (R13). Every route with a record id, in its path or its body (#248: the create's
// clientId and engagementId), is behind the esign module, which is off in every firm until
// r0_esign adds its tables; real cases (params and bodyIds) replace these then.
import type { CaseModule } from '../world.js';

const OFF = 'behind the esign module, off everywhere until r0_esign (#156)';

export const moduleOff: CaseModule['moduleOff'] = {
  'POST /api/v1/esign/requests': OFF,
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
  'POST /api/v1/esign/requests/:id/remind': OFF,
  'POST /api/v1/esign/requests/:id/void': OFF,
  'POST /api/v1/esign/requests/:id/recipients/:recipientId/correct': OFF,
  'POST /api/v1/esign/requests/:id/replace': OFF,
  'POST /api/v1/esign/requests/:id/documents/uploads': OFF,
  'POST /api/v1/esign/requests/:id/documents/uploads/confirm': OFF,
  'DELETE /api/v1/esign/requests/:id/documents/:documentId': OFF,
  'POST /api/v1/esign/requests/:id/documents/from-vault': OFF,
  'GET /api/v1/esign/requests/:id/documents/:documentId/content': OFF,
  'GET /api/v1/esign/templates/:templateId': OFF,
  'PATCH /api/v1/esign/templates/:templateId': OFF,
  'POST /api/v1/esign/templates/:templateId/archive': OFF,
  'GET /api/v1/esign/templates/:templateId/packet': OFF,
  'POST /api/v1/esign/templates/:templateId/use': OFF,
  'POST /api/v1/esign/templates/:templateId/duplicate': OFF,
  'POST /api/v1/esign/requests/:id/save-as-template': OFF,
};
