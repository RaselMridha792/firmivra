// Firm Sign (R13). Every route with a record id, in its path or its body, is behind the esign
// module, which is off in every firm until r0_esign adds its tables; real cases replace these then.
import type { CaseModule } from '../world.js';

const OFF = 'behind the esign module, off everywhere until r0_esign (#156)';

export const moduleOff: CaseModule['moduleOff'] = {
  'POST /api/v1/esign/requests': OFF,
  'GET /api/v1/esign/requests/:id': OFF,
  'PATCH /api/v1/esign/requests/:id': OFF,
  'DELETE /api/v1/esign/requests/:id': OFF,
};
