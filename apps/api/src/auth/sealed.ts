import { hkdfSync } from 'node:crypto';
import { EncryptJWT, jwtDecrypt } from 'jose';
import type { z } from 'zod';
import { IdentityPool } from '@firmivra/types';
import type { Env } from '../config/env.js';

export type PoolSecrets = Partial<Record<IdentityPool, string | undefined>>;

/**
 * Each pool's secret: its Cognito client secret, or LOCAL_AUTH_SECRET in local mode.
 * R1/R8: replace with a dedicated AUTH_SESSION_KEY from Secrets Manager.
 */
export function poolSecrets(env: Env): PoolSecrets {
  if (env.AUTH_MODE === 'local') {
    const s = env.LOCAL_AUTH_SECRET;
    return { STAFF: s, CLIENT: s, ADMIN: s };
  }
  return {
    STAFF: env.COGNITO_STAFF_CLIENT_SECRET,
    CLIENT: env.COGNITO_CLIENTS_CLIENT_SECRET,
    ADMIN: env.COGNITO_ADMINS_CLIENT_SECRET,
  };
}

/** HKDF-SHA256 with the pool as salt and the purpose as label: never the secret itself. */
export function deriveKey(secret: string, pool: IdentityPool, label: string): Uint8Array {
  return new Uint8Array(hkdfSync('sha256', secret, pool, label, 32));
}

/**
 * Values the browser holds but can neither read nor change: JWE (dir + A256GCM) with an expiry,
 * bound to one pool, so a value from one site never opens on another.
 */
export class Sealer<T extends { pool: IdentityPool }> {
  private readonly keys: Partial<Record<IdentityPool, Uint8Array>> = {};

  constructor(
    label: string,
    private readonly schema: z.ZodType<T>,
    secrets: PoolSecrets,
  ) {
    for (const pool of IdentityPool.options) {
      const secret = secrets[pool];
      if (secret) this.keys[pool] = deriveKey(secret, pool, label);
    }
  }

  async seal(value: T, ttlSeconds: number): Promise<string> {
    return new EncryptJWT({ ...value })
      .setProtectedHeader({ alg: 'dir', enc: 'A256GCM' })
      .setIssuedAt()
      .setExpirationTime(`${ttlSeconds}s`)
      .encrypt(this.key(value.pool));
  }

  /** The value, or undefined when it is expired, tampered with or from another pool. */
  async open(token: string, pool: IdentityPool): Promise<T | undefined> {
    try {
      const { payload } = await jwtDecrypt(token, this.key(pool), {
        keyManagementAlgorithms: ['dir'],
        contentEncryptionAlgorithms: ['A256GCM'],
      });
      const value = this.schema.safeParse(payload);
      return value.success && value.data.pool === pool ? value.data : undefined;
    } catch {
      return undefined;
    }
  }

  private key(pool: IdentityPool): Uint8Array {
    const key = this.keys[pool];
    if (!key) throw new Error(`No sealing key for the ${pool} pool`);
    return key;
  }
}
