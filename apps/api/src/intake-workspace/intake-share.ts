import { createHmac } from 'node:crypto';
import { INTAKE_SHARE_PATH } from '@firmivra/types';
import { deriveKey, poolSecrets } from '../auth/sealed.js';
import { hashToken } from '../begin-online/drafts.js';
import type { Env } from '../config/env.js';

// INTAKE-ACCESS-02 (decision 2, Nov 15): a form's share link is stable, so the firm can see and copy
// it at any time: its token is an HMAC of the template's id under a key derived from the server's
// client-pool secret (never the secret itself), and only the token's SHA-256 is kept
// (intake_templates.share_token_hash, unique), to find the form and to turn the link off. Off
// clears the hash, so the link refuses at once; on again brings back the same link. Intake Review 2
// P4-16: Make a New Link adds 1 to intake_templates.share_link_version, which the token's HMAC
// takes in, so the old link stops at once; version 0 is the token every form had before, so no
// link already out changed.

/** The form's share token (43 characters, base64url), for its link generation. */
export function intakeShareToken(env: Env, templateId: string, version = 0): string {
  const secret = poolSecrets(env).CLIENT;
  if (!secret) throw new Error('No client-pool secret for intake share links');
  const key = deriveKey(secret, 'CLIENT', 'fv-intake-share-v1');
  const input =
    version === 0 ? `intake-share:${templateId}` : `intake-share:${templateId}:v${version}`;
  return createHmac('sha256', key).update(input).digest('base64url');
}

/** What intake_templates.share_token_hash holds for the form's link. */
export const intakeShareHash = (env: Env, templateId: string, version = 0) =>
  hashToken(intakeShareToken(env, templateId, version));

/** The share link: `{PORTAL_BASE_URL}/{slug}/start/{token}`, the host from config. */
export function intakeShareUrl(
  env: Env,
  firmSlug: string,
  templateId: string,
  version = 0,
): string {
  const base = env.PORTAL_BASE_URL.replace(/\/+$/, '');
  const token = intakeShareToken(env, templateId, version);
  return `${base}/${encodeURIComponent(firmSlug)}/${INTAKE_SHARE_PATH}/${token}`;
}
