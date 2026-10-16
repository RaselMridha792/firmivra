// The firm dashboard (R30): GET /api/v1/business/dashboard/summary. It takes no record id in its
// path or body, so it needs no case: the suite's sweep covers it like every other list (firm Q
// naming firm P is 404; firm Q's summary names none of firm P's records, its tasks included).
// test/e2e/dashboard.e2e.test.ts checks that each firm's numbers are its own.
import type { CaseModule } from '../world.js';

export const cases: CaseModule['cases'] = {};
