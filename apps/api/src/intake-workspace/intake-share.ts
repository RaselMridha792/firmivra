import { createHmac } from 'node:crypto';
import { INTAKE_SHARE_PATH } from '@firmivra/types';
import { deriveKey, poolSecrets } from '../auth/sealed.js';
import { hashToken } from '../begin-online/drafts.js';
import type { Env } from '../config/env.js';

// INTAKE-ACCESS-02 (decision 2, Nov 15): a form's share link is stable, so the firm can see and copy
// it at any time: its token is an HMAC of the template's id under a key derived from the server's
// client-pool secret (never the secret itself), and only the token's SHA-256 is kept
// (intake_templates.share_token_hash, unique), to find the form and to turn the link off. Off
// clears the hash, so the link refuses at once; on again brings back the same link. A new link
// (rotation) needs a column of its own (after Nov 17).

/** The form's share token (43 characters, base64url). */
export function intakeShareToken(env: Env, templateId: string): string {
  const secret = poolSecrets(env).CLIENT;
  if (!secret) throw new Error('No client-pool secret for intake share links');
  const key = deriveKey(secret, 'CLIENT', 'fv-intake-share-v1');
  return createHmac('sha256', key).update(`intake-share:${templateId}`).digest('base64url');
}

/** What intake_templates.share_token_hash holds for the form's link. */
export const intakeShareHash = (env: Env, templateId: string) =>
  hashToken(intakeShareToken(env, templateId));

/** The share link: `{PORTAL_BASE_URL}/{slug}/start/{token}`, the host from config. */
export function intakeShareUrl(env: Env, firmSlug: string, templateId: string): string {
  const base = env.PORTAL_BASE_URL.replace(/\/+$/, '');
  const token = intakeShareToken(env, templateId);
  return `${base}/${encodeURIComponent(firmSlug)}/${INTAKE_SHARE_PATH}/${token}`;
}
