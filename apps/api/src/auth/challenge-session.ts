import { hkdfSync } from 'node:crypto';
import { EncryptJWT, jwtDecrypt } from 'jose';
import { z } from 'zod';
import { IdentityPool } from '@firmivra/types';
import type { Env } from '../config/env.js';

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
});
export type Challenge = z.infer<typeof Challenge>;

/**
 * The `session` the browser holds between sign-in steps: the challenge, encrypted and
 * authenticated (JWE, dir + A256GCM), expiring after 3 minutes. Keys are derived with HKDF from
 * each pool's client secret (never the secret itself), salted with the pool name, so a session
 * from one site can never be opened on another. R1/R8: move to a dedicated AUTH_SESSION_KEY.
 */
export class ChallengeSessions {
  private constructor(private readonly keys: Partial<Record<IdentityPool, Uint8Array>>) {}

  static fromEnv(env: Env): ChallengeSessions {
    const secrets: Partial<Record<IdentityPool, string | undefined>> =
      env.AUTH_MODE === 'local'
        ? {
            STAFF: env.LOCAL_AUTH_SECRET,
            CLIENT: env.LOCAL_AUTH_SECRET,
            ADMIN: env.LOCAL_AUTH_SECRET,
          }
        : {
            STAFF: env.COGNITO_STAFF_CLIENT_SECRET,
            CLIENT: env.COGNITO_CLIENTS_CLIENT_SECRET,
            ADMIN: env.COGNITO_ADMINS_CLIENT_SECRET,
          };
    return ChallengeSessions.fromSecrets(secrets);
  }

  static fromSecrets(
    secrets: Partial<Record<IdentityPool, string | undefined>>,
  ): ChallengeSessions {
    const keys: Partial<Record<IdentityPool, Uint8Array>> = {};
    for (const pool of IdentityPool.options) {
      const secret = secrets[pool];
      if (secret) keys[pool] = deriveChallengeKey(secret, pool);
    }
    return new ChallengeSessions(keys);
  }

  async seal(challenge: Challenge): Promise<string> {
    return new EncryptJWT({ ...challenge })
      .setProtectedHeader({ alg: 'dir', enc: 'A256GCM' })
      .setIssuedAt()
      .setExpirationTime(`${TTL_SECONDS}s`)
      .encrypt(this.key(challenge.pool));
  }

  /** The challenge, or undefined when the session is expired, tampered with or from another pool. */
  async open(token: string, pool: IdentityPool): Promise<Challenge | undefined> {
    try {
      const { payload } = await jwtDecrypt(token, this.key(pool), {
        keyManagementAlgorithms: ['dir'],
        contentEncryptionAlgorithms: ['A256GCM'],
      });
      const challenge = Challenge.safeParse(payload);
      return challenge.success && challenge.data.pool === pool ? challenge.data : undefined;
    } catch {
      return undefined;
    }
  }

  private key(pool: IdentityPool): Uint8Array {
    const key = this.keys[pool];
    if (!key) throw new Error(`No challenge-session key for the ${pool} pool`);
    return key;
  }
}

export function deriveChallengeKey(secret: string, pool: IdentityPool): Uint8Array {
  return new Uint8Array(hkdfSync('sha256', secret, pool, CHALLENGE_KEY_LABEL, 32));
}
