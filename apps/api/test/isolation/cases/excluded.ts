// Routes that are neither a firm route nor a portal route, and why the suite leaves them out.
// The Super Admin routes are not listed: the suite sweeps every one of them instead.
import type { CaseModule } from '../world.js';

const SIGN_IN = 'Public sign-in step: no firm or client data before a session exists';
const SIGN_UP = 'Public portal sign-up step: answers the same whether or not an account exists';

export const excluded: CaseModule['excluded'] = {
  'GET /api/v1/health': 'Public health check, no data',
  'GET /api/v1/me': "The session's own login and memberships, from the token",
  'POST /api/v1/firm-applications': 'Public: a new firm applies; no firm exists yet',
  'POST /api/v1/auth/sign-in': SIGN_IN,
  'POST /api/v1/auth/mfa': SIGN_IN,
  'POST /api/v1/auth/mfa/setup': SIGN_IN,
  'POST /api/v1/auth/refresh': SIGN_IN,
  'POST /api/v1/auth/sign-out': SIGN_IN,
  'POST /api/v1/auth/forgot-password': SIGN_IN,
  'POST /api/v1/auth/reset-password': SIGN_IN,
  'POST /api/v1/admin/auth/sign-in': SIGN_IN,
  'POST /api/v1/admin/auth/mfa': SIGN_IN,
  'POST /api/v1/admin/auth/mfa/setup': SIGN_IN,
  'POST /api/v1/admin/auth/refresh': SIGN_IN,
  'POST /api/v1/admin/auth/sign-out': SIGN_IN,
  'POST /api/v1/admin/auth/forgot-password': SIGN_IN,
  'POST /api/v1/admin/auth/reset-password': SIGN_IN,
  'POST /api/v1/auth/activation/check': 'Public: checks an invite code, ids from the code only',
  'POST /api/v1/auth/activate': 'Public: an invited person sets a password from the code',
  'POST /api/v1/auth/activation/accept': 'A signed-in person accepts their own invite',
  'GET /api/v1/portal/:firmSlug/info': "Public: the firm's name and branding for its portal",
  'GET /api/v1/portal/:firmSlug/legal/:kind': "Public: the firm's published terms and privacy",
  'POST /api/v1/portal/:firmSlug/auth/sign-up': SIGN_UP,
  'GET /api/v1/portal/:firmSlug/auth/sign-up': SIGN_UP,
  'POST /api/v1/portal/:firmSlug/auth/sign-up/verify-email': SIGN_UP,
  'POST /api/v1/portal/:firmSlug/auth/sign-up/verify-phone': SIGN_UP,
  'POST /api/v1/portal/:firmSlug/auth/sign-up/resend': SIGN_UP,
  'POST /api/v1/portal/:firmSlug/auth/sign-up/change-email': SIGN_UP,
  'POST /api/v1/portal/:firmSlug/auth/sign-up/change-phone': SIGN_UP,
  'POST /api/v1/portal/:firmSlug/auth/sign-in': SIGN_IN,
  'POST /api/v1/portal/:firmSlug/auth/mfa': SIGN_IN,
  'POST /api/v1/portal/:firmSlug/auth/mfa/setup': SIGN_IN,
  'POST /api/v1/portal/:firmSlug/auth/refresh': SIGN_IN,
  'POST /api/v1/portal/:firmSlug/auth/sign-out': SIGN_IN,
  'POST /api/v1/portal/:firmSlug/auth/forgot-password': SIGN_IN,
  'POST /api/v1/portal/:firmSlug/auth/reset-password': SIGN_IN,
  'GET /api/v1/portal/:firmSlug/me': "The client's own login at this firm, from the session",
  'POST /api/v1/dev/token': 'Local only (AUTH_MODE=local): mints a test token',
  'POST /api/v1/dev/sign-out': 'Local only (AUTH_MODE=local)',
};
