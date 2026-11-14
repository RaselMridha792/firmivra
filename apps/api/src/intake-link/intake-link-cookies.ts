import type { Request, Response } from 'express';
import { z } from 'zod';
import { type PoolSecrets, Sealer } from '../auth/sealed.js';

/**
 * A lead's secure-link cookie at one firm: HttpOnly, on /api/v1/portal/{firmSlug}/intake-link
 * only, a few hours. crossSiteGuard counts `fv_il_` cookies as session cookies.
 */
export function intakeLinkCookie(firmSlug: string) {
  const slug = firmSlug.toLowerCase();
  return { name: `fv_il_${slug}`, path: `/api/v1/portal/${slug}/intake-link` } as const;
}

/** How long the cookie lasts; opening the link again sets it again. Never past the link. */
export const LINK_COOKIE_SECONDS = 6 * 60 * 60;

/**
 * What the cookie binds: the firm, the intake and the link's token hash, so a resend or a
 * reminder (a new token) ends the older link's cookies too.
 */
const LinkClaim = z.object({
  pool: z.literal('CLIENT'),
  businessId: z.uuid(),
  intakeId: z.uuid(),
  tokenHash: z.string().regex(/^[0-9a-f]{64}$/),
});
export type LinkClaim = z.infer<typeof LinkClaim>;

type FirmRef = { id: string; slug: string };

/** The cookie's value: sealed by the API (JWE with an expiry), never a bare id or the token. */
export class IntakeLinkCookies extends Sealer<LinkClaim> {
  constructor(secrets: PoolSecrets) {
    super('fv-intake-link-v1', LinkClaim, secrets);
  }

  /** This browser's claim for the firm, or null. */
  async read(req: Request, firm: FirmRef): Promise<LinkClaim | null> {
    const value = (req.cookies as Record<string, unknown> | undefined)?.[
      intakeLinkCookie(firm.slug).name
    ];
    if (typeof value !== 'string' || value.length > 2048) return null;
    const claim = (await this.open(value, 'CLIENT'))?.value;
    return claim?.businessId === firm.id ? claim : null;
  }

  async write(
    res: Response,
    firm: FirmRef,
    claim: Omit<LinkClaim, 'pool' | 'businessId'>,
    linkExpiresAt: Date,
    secure: boolean,
  ): Promise<void> {
    const until = Math.min(Date.now() + LINK_COOKIE_SECONDS * 1000, linkExpiresAt.getTime());
    const value = await this.sealUntil(
      { pool: 'CLIENT', businessId: firm.id, ...claim },
      Math.floor(until / 1000),
    );
    const { name, path } = intakeLinkCookie(firm.slug);
    res.cookie(name, value, {
      httpOnly: true,
      secure,
      sameSite: 'strict',
      path,
      maxAge: Math.max(0, until - Date.now()),
    });
  }
}
