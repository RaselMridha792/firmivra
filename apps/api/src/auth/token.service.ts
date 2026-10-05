import { Inject, Injectable } from '@nestjs/common';
import { CognitoJwtVerifier } from 'aws-jwt-verify';
import { jwtVerify, SignJWT } from 'jose';
import { IdentityPool } from '@firmivra/types';
import { ENV } from '../config/config.module.js';
import type { Env } from '../config/env.js';

export const ACCESS_COOKIE = 'fv_access';

const LOCAL_ISSUER = 'firmivra-local';
const LOCAL_AUDIENCE = 'firmivra-api';
const LOCAL_TTL_SECONDS = 60 * 60;

export interface VerifiedToken {
  sub: string;
  pool: IdentityPool;
}

/**
 * Verifies access tokens. AUTH_MODE=cognito: Cognito access tokens from the three user pools
 * (docs/AUTH-DESIGN.md). AUTH_MODE=local: tokens this API signed with LOCAL_AUTH_SECRET.
 * Tokens only say who the person is; roles always come from the database.
 */
@Injectable()
export class TokenService {
  private readonly localKey?: Uint8Array;
  private readonly cognito?: { verify: (token: string) => Promise<VerifiedToken> };

  constructor(@Inject(ENV) private readonly env: Env) {
    if (env.AUTH_MODE === 'local') {
      this.localKey = new TextEncoder().encode(env.LOCAL_AUTH_SECRET);
    } else {
      this.cognito = createCognitoVerifier(env);
    }
  }

  async verify(token: string): Promise<VerifiedToken> {
    if (this.cognito) return this.cognito.verify(token);
    const { payload } = await jwtVerify(token, this.localKeyOrThrow(), {
      issuer: LOCAL_ISSUER,
      audience: LOCAL_AUDIENCE,
      algorithms: ['HS256'],
    });
    if (!payload.sub) throw new Error('token has no subject');
    return { sub: payload.sub, pool: IdentityPool.parse(payload['pool']) };
  }

  /** Local development only (POST /api/v1/dev/token). */
  async signLocal(sub: string, pool: IdentityPool): Promise<{ token: string; expiresIn: number }> {
    const token = await new SignJWT({ pool })
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject(sub)
      .setIssuer(LOCAL_ISSUER)
      .setAudience(LOCAL_AUDIENCE)
      .setIssuedAt()
      .setExpirationTime(`${LOCAL_TTL_SECONDS}s`)
      .sign(this.localKeyOrThrow());
    return { token, expiresIn: LOCAL_TTL_SECONDS };
  }

  private localKeyOrThrow(): Uint8Array {
    if (!this.localKey) throw new Error('Local tokens are only available when AUTH_MODE=local');
    return this.localKey;
  }
}

function createCognitoVerifier(env: Env) {
  const pools: { pool: IdentityPool; userPoolId: string; clientId: string }[] = [
    {
      pool: 'STAFF',
      userPoolId: env.COGNITO_STAFF_USER_POOL_ID!,
      clientId: env.COGNITO_STAFF_CLIENT_ID!,
    },
    {
      pool: 'CLIENT',
      userPoolId: env.COGNITO_CLIENTS_USER_POOL_ID!,
      clientId: env.COGNITO_CLIENTS_CLIENT_ID!,
    },
    {
      pool: 'ADMIN',
      userPoolId: env.COGNITO_ADMINS_USER_POOL_ID!,
      clientId: env.COGNITO_ADMINS_CLIENT_ID!,
    },
  ];
  const verifier = CognitoJwtVerifier.create(
    pools.map((p) => ({
      userPoolId: p.userPoolId,
      clientId: p.clientId,
      tokenUse: 'access' as const,
    })),
  );
  return {
    async verify(token: string): Promise<VerifiedToken> {
      const payload = await verifier.verify(token);
      const match = pools.find((p) => payload.iss.endsWith(`/${p.userPoolId}`));
      if (!match) throw new Error('token from an unknown user pool');
      return { sub: payload.sub, pool: match.pool };
    },
  };
}
