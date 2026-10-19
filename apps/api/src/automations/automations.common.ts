import { BadRequestException, ConflictException, ForbiddenException } from '@nestjs/common';
import {
  isGridFirmRole,
  roleCan,
  type AutomationCheck,
  type AutomationErrorCode,
  type PermissionCapability,
  type PermissionModule,
} from '@firmivra/types';
import type { TenantContext } from '../common/request-context.js';

const refusal = (code: AutomationErrorCode, message: string, details?: unknown) =>
  new ConflictException({ code, message, ...(details === undefined ? {} : { details }) });

export const autoErrors = {
  duplicateName: () => refusal('DUPLICATE_NAME', 'A live rule has this name'),
  saveConflict: () =>
    refusal('SAVE_CONFLICT', 'Someone saved this after you opened it. Reload and try again.'),
  notReady: (checks: AutomationCheck[]) =>
    refusal(
      'NOT_READY',
      'The rule cannot be active yet',
      checks.map((c) => ({ path: c.path ?? 'rule', message: c.message })),
    ),
  ruleArchived: () => refusal('RULE_ARCHIVED', 'Restore the rule before changing it'),
  invalidStatus: (message: string) => refusal('INVALID_STATUS', message),
  rerunNotAllowed: (message: string) => refusal('RERUN_NOT_ALLOWED', message),
  tooManyRows: () =>
    refusal('TOO_MANY_ROWS', 'There are too many runs to export; narrow the filter'),
  templateUnavailable: (message: string) => refusal('TEMPLATE_UNAVAILABLE', message),
  notAMember: () => refusal('NOT_A_MEMBER', 'That person is not an active member of the firm'),
  forbidden: () =>
    new ForbiddenException({ code: 'FORBIDDEN', message: 'You do not have access to this action' }),
  invalid: (path: string, message: string) =>
    new BadRequestException({
      code: 'VALIDATION_FAILED',
      message: 'The request is not valid',
      details: [{ path, message }],
    }),
};

export interface Perms {
  admin: boolean;
  /** Create, edit, test, retry, export settings: Create, Edit or Manage. */
  write: boolean;
  activate: boolean;
  export: boolean;
  /** Automation Admin: the settings and forcing a run. */
  manage: boolean;
}

/**
 * Owner and Admin may always; the other roles follow the grid's AUTOMATIONS row. Everyone with the
 * module reads. The legacy Staff role reads only.
 */
export function permsOf(tenant: TenantContext | undefined): Perms {
  const none = { admin: false, write: false, activate: false, export: false, manage: false };
  if (tenant?.kind !== 'staff') return none;
  const role = tenant.role;
  if (role === 'OWNER' || role === 'ADMIN')
    return { admin: true, write: true, activate: true, export: true, manage: true };
  if (!isGridFirmRole(role)) return none;
  const can = (cap: PermissionCapability) => roleCan(role, 'AUTOMATIONS', cap);
  const manage = can('MANAGE');
  return {
    admin: false,
    write: can('CREATE') || can('EDIT') || manage,
    activate: can('APPROVE') || manage,
    export: can('EXPORT') || manage,
    manage,
  };
}

/** May this person (by role) act in the module with the module's own permission? */
export function mayAct(role: string, module: string): boolean {
  if (role === 'OWNER' || role === 'ADMIN') return true;
  if (role === 'STAFF') return ['CLIENTS', 'TASKS', 'COMMUNICATIONS'].includes(module);
  if (!isGridFirmRole(role as never)) return false;
  return roleCan(role as never, module as PermissionModule, 'CREATE');
}

export const iso = (d: Date | null) => d?.toISOString() ?? null;

/** "HH:MM" of a stored time of day. */
export const hhmm = (d: Date | null) => (d ? d.toISOString().slice(11, 16) : null);
