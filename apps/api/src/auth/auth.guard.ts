import {
  type CanActivate,
  type ExecutionContext,
  Inject,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import type { Database } from '@firmivra/db';
import { requestContext } from '../common/request-context.js';
import { DATABASE } from '../database/database.module.js';
import { isPublic } from './decorators.js';
import { ACCESS_COOKIE, TokenService } from './token.service.js';

function readToken(req: Request): string | undefined {
  const cookies = req.cookies as Record<string, string | undefined> | undefined;
  const fromCookie = cookies?.[ACCESS_COOKIE];
  if (fromCookie) return fromCookie;
  const header = req.get('authorization');
  return header?.startsWith('Bearer ') ? header.slice('Bearer '.length) : undefined;
}

const unauthenticated = () =>
  new UnauthorizedException({ code: 'UNAUTHENTICATED', message: 'Sign in required' });

/** Global guard 1: every non-public route needs a valid token for a known user of the matching pool. */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly tokens: TokenService,
    @Inject(DATABASE) private readonly db: Database,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    if (isPublic(this.reflector, ctx)) return true;
    const req = ctx.switchToHttp().getRequest<Request>();

    const token = readToken(req);
    if (!token) throw unauthenticated();
    const claims = await this.tokens.verify(token).catch(() => {
      throw unauthenticated();
    });

    const user = await this.db
      .forPlatform()
      .user.findUnique({ where: { cognitoSub: claims.sub }, select: { id: true, pool: true } });
    if (!user || user.pool !== claims.pool) throw unauthenticated();

    const auth = { userId: user.id, cognitoSub: claims.sub, pool: user.pool };
    req.auth = auth;
    const store = requestContext.getStore();
    if (store) store.auth = auth;
    return true;
  }
}
