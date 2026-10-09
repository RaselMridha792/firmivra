import { Inject, Injectable } from '@nestjs/common';
import type { EsignStatus } from '@firmivra/types';
import { BUSINESS_MODULES, type BusinessModules } from '../../common/modules/requires-module.js';
import type { TenantRole } from '../../common/request-context.js';

/** The signed-in member and their firm role (from TenantGuard). */
export interface EsignActor {
  userId: string;
  role: Exclude<TenantRole, 'CLIENT'>;
}

/**
 * Firm Sign requests, part 1 (R13 step 6): the module switch and status. Drafts, the page plan
 * and recipients follow in part 1b.
 */
@Injectable()
export class EsignRequestsService {
  constructor(@Inject(BUSINESS_MODULES) private readonly modules: BusinessModules) {}

  /** Never MODULE_OFF: off is `{ enabled: false, myEsignRole: null }`. */
  async status(businessId: string, actor: EsignActor): Promise<EsignStatus> {
    const enabled = await this.modules.isEnabled(businessId, 'esign');
    // TODO(r0_esign, part 1b): MANAGER and VIEWER need the member's stored Firm Sign role, which
    // r0_esign adds; until then the firm role is the answer.
    return { enabled, myEsignRole: enabled ? actor.role : null };
  }
}
