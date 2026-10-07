import { z } from 'zod';
import { IdentityPool } from '@firmivra/types';
import type { Env } from '../config/env.js';
import { deriveKey, type PoolSecrets, poolSecrets, Sealer } from './sealed.js';

/** HKDF label for challenge-session keys. A new label (v2) invalidates every open session. */
export const CHALLENGE_KEY_LABEL = 'fv-auth-challenge-v1';
/** Cognito's own sign-in session lives 3 minutes. */
const TTL_SECONDS = 180;

const Challenge = z.object({
  userId: z.string(),
  /** Cognito username (never sent to the browser in clear). */
  username: z.string(),
  /** Cognito's session for the next call. */
  session: z.string(),
  /** MFA: code expected. MFA_SETUP: call mfa/setup next. MFA_SETUP_VERIFY: first code expected. */
  step: z.enum(['MFA', 'MFA_SETUP', 'MFA_SETUP_VERIFY']),
  pool: IdentityPool,
  /** Client portal sign-ins: the firm. The challenge opens only on that firm's portal. */
  businessId: z.string().optional(),
});
export type Challenge = z.infer<typeof Challenge>;

/** The `session` the browser holds between sign-in steps: the challenge, sealed for 3 minutes. */
export class ChallengeSessions {
  private constructor(private readonly sealer: Sealer<Challenge>) {}

  static fromEnv(env: Env): ChallengeSessions {
    return ChallengeSessions.fromSecrets(poolSecrets(env));
  }

  static fromSecrets(secrets: PoolSecrets): ChallengeSessions {
    return new ChallengeSessions(new Sealer(CHALLENGE_KEY_LABEL, Challenge, secrets));
  }

  seal(challenge: Challenge): Promise<string> {
    return this.sealer.seal(challenge, TTL_SECONDS);
  }

  /** The challenge, if it was sealed for this pool and (on a portal) this firm. */
  async open(
    token: string,
    pool: IdentityPool,
    businessId?: string,
  ): Promise<Challenge | undefined> {
    const challenge = (await this.sealer.open(token, pool))?.value;
    return challenge?.businessId === businessId ? challenge : undefined;
  }
}

export function deriveChallengeKey(secret: string, pool: IdentityPool): Uint8Array {
  return deriveKey(secret, pool, CHALLENGE_KEY_LABEL);
}
