import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import type { IdentityPool } from '@firmivra/types';

/** Who is signed in. Set by AuthGuard. */
export interface AuthContext {
  userId: string;
  cognitoSub: string;
  pool: IdentityPool;
}

export type TenantRole = 'OWNER' | 'ADMIN' | 'STAFF' | 'CLIENT';

/** Which firm the request acts in and the caller's role there, from the database. Set by TenantGuard. */
export type TenantContext =
  | { businessId: string; role: Exclude<TenantRole, 'CLIENT'>; kind: 'staff' }
  | {
      businessId: string;
      role: 'CLIENT';
      kind: 'client';
      /** The caller's own ClientAccount here: portal routes take the client from it, never the URL. */
      clientAccountId: string;
    };

/** A verified Firmivra Super Admin, allowed onto platform tables. Set by RolesGuard. */
export interface PlatformContext {
  role: 'SUPER_ADMIN';
}

export interface RequestStore {
  requestId: string;
  ip?: string;
  userAgent?: string;
  auth?: AuthContext;
  tenant?: TenantContext;
  platform?: PlatformContext;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace -- Express's documented way to type req
  namespace Express {
    interface Request {
      id?: string;
      auth?: AuthContext;
      tenant?: TenantContext;
      platform?: PlatformContext;
    }
  }
}

/** Per-request context (request id, caller, tenant) that services read without request-scoped providers. */
export const requestContext = new AsyncLocalStorage<RequestStore>();

const REQUEST_ID = /^[A-Za-z0-9._-]{1,100}$/;

/** First middleware: gives every request an id (x-request-id) and opens its context. */
export function requestContextMiddleware(req: Request, res: Response, next: NextFunction): void {
  const incoming = req.get('x-request-id');
  const requestId = incoming && REQUEST_ID.test(incoming) ? incoming : randomUUID();
  req.id = requestId;
  res.setHeader('x-request-id', requestId);
  requestContext.run({ requestId, ip: req.ip, userAgent: req.get('user-agent') }, next);
}
