import type { EsignAccessRole } from '@firmivra/types';

/** Who may start and change requests: a Firm Sign Viewer only reads. */
export const canCreate = (role: EsignAccessRole | null) => !!role && role !== 'VIEWER';

/** Owner and Admin: Signing Settings and roles. */
export const isFirmManager = (role: EsignAccessRole | null) => role === 'OWNER' || role === 'ADMIN';
