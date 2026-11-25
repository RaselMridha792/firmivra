import type { CaseModule } from '../world.js';

/** Public access is bound to an emailed random link, then a verified short-lived grant session. */
export const excluded: NonNullable<CaseModule['excluded']> = {
  'POST /api/v1/closed-firm-download/request-code':
    'Public owner-link endpoint; the random link token is validated against its grant and the code is emailed only to that grant’s owner.',
  'POST /api/v1/closed-firm-download/verify-code':
    'Public owner-link endpoint; the random link and one-time email code are validated before issuing a grant-bound session.',
  'GET /api/v1/closed-firm-download/clients':
    'Public endpoint; the short-lived signed session selects the closed firm and cannot be chosen by the caller.',
  'GET /api/v1/closed-firm-download/files':
    'Public endpoint; the short-lived signed session selects the closed firm and only clean scanned files are returned.',
  'POST /api/v1/closed-firm-download/files/:fileId/link':
    'Public endpoint; both the signed grant session and a clean document belonging to that grant are required.',
  'GET /api/v1/closed-firm-download/clients.csv':
    'Public endpoint; the short-lived signed session selects the closed firm and its clients.',
};
