import type { EsignAccessRole } from '@firmivra/types';

/** Who may start and change requests: a Firm Sign Viewer only reads. */
export const canCreate = (role: EsignAccessRole | null) => !!role && role !== 'VIEWER';

/** Owner and Admin: Signing Settings and roles (not the Firm Sign Manager role). */
export const isOwnerOrAdmin = (role: EsignAccessRole | null) =>
  role === 'OWNER' || role === 'ADMIN';

/** Who can be a request's approver: an Owner, Admin or Firm Sign Manager. */
export const canApprove = (role: EsignAccessRole | null) =>
  role === 'OWNER' || role === 'ADMIN' || role === 'MANAGER';
