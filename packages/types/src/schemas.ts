import { z } from 'zod';
import {
  BusinessStatus,
  ClientAccountStatus,
  IdentityPool,
  MembershipRole,
  MembershipStatus,
} from './db-enums.js';

// ---------- Errors ----------
/** Every API error has this shape. Codes are stable; messages are for people. */
export const ApiError = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    requestId: z.string().optional(),
    details: z.unknown().optional(),
  }),
});
export type ApiError = z.infer<typeof ApiError>;

/** Body of endpoints that only confirm success. */
export const OkResponse = z.object({ ok: z.literal(true) });
export type OkResponse = z.infer<typeof OkResponse>;

// ---------- Health ----------
export const HealthResponse = z.object({
  status: z.enum(['ok', 'degraded']),
  db: z.enum(['ok', 'down']),
});
export type HealthResponse = z.infer<typeof HealthResponse>;

// ---------- Database enums ----------
// Every database enum, generated from the Prisma schema (db-enums.ts), so values never drift.
export * from './db-enums.js';

// ---------- Identity ----------
export const BusinessSummary = z.object({
  id: z.uuid(),
  slug: z.string(),
  name: z.string(),
  status: BusinessStatus,
});
export type BusinessSummary = z.infer<typeof BusinessSummary>;

/** GET /api/v1/me: who is signed in and which firms they can open. Roles come from the database. */
export const MeResponse = z.object({
  user: z.object({
    id: z.uuid(),
    email: z.string(),
    name: z.string(),
    pool: IdentityPool,
  }),
  memberships: z.array(
    z.object({
      business: BusinessSummary,
      role: MembershipRole,
      status: MembershipStatus,
    }),
  ),
  clientAccounts: z.array(z.object({ business: BusinessSummary, status: ClientAccountStatus })),
  platformAdmin: z.boolean(),
});
export type MeResponse = z.infer<typeof MeResponse>;

/**
 * A firm's portal address (portal.firmivra.com/{slug}): lower-case letters, digits and inner
 * hyphens. Portal clients check it before building a path, so `..` or `/` never reach a URL.
 */
export const FirmSlug = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/, 'Not a valid firm address');

// ---------- Local development sign-in (AUTH_MODE=local only) ----------
/** POST /api/v1/dev/token: sign in as a seeded user. Never available outside local development. */
export const DevTokenRequest = z.object({
  email: z.email().transform((e) => e.toLowerCase()),
  pool: IdentityPool.optional(),
});
export type DevTokenRequest = z.input<typeof DevTokenRequest>;

export const DevTokenResponse = z.object({
  token: z.string(),
  expiresIn: z.number().int().positive(),
  user: MeResponse.shape.user,
});
export type DevTokenResponse = z.infer<typeof DevTokenResponse>;
