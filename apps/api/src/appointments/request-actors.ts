import { z } from 'zod';
import type { AuthContext, TenantContext } from '../common/request-context.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import type { FirmActor } from './calendar-data.js';

/** The signed-in member on a firm route (firm roles only, see @Roles). */
export function firmActor(
  auth: AuthContext | undefined,
  tenant: TenantContext | undefined,
): FirmActor {
  if (!auth || tenant?.kind !== 'staff') throw new Error('appointment routes are for firm members');
  return { userId: auth.userId, role: tenant.role };
}

/** The signed-in client login on a portal route: from the session, never the URL. */
export function portalLogin(tenant: TenantContext | undefined): {
  businessId: string;
  clientAccountId: string;
} {
  if (tenant?.kind !== 'client') throw new Error('portal routes are for client logins');
  return { businessId: tenant.businessId, clientAccountId: tenant.clientAccountId };
}

/** A body whose fields are all optional (cancel): no body at all reads as `{}`. */
export const optionalBody = <S extends z.ZodType>(schema: S) =>
  new ZodValidationPipe(z.preprocess((value) => value ?? {}, schema));
