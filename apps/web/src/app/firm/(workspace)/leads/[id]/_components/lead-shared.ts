import type { ReviewedLeadStatus } from '@firmivra/types';

/** Every query of one lead starts here; the inbox (`['leads', ...]`) refreshes with it. */
export const leadKey = (id: string) => ['leads', 'detail', id];

/** The leads error codes (packages/types leads), in the firm's words. */
export const LEAD_ERRORS: Record<string, string> = {
  INVALID_STATUS: 'This lead was already converted or declined. Reload to see it.',
  DUPLICATE_EMAIL: 'Another client already has this email.',
  CLIENT_ARCHIVED: 'That client is archived. Restore the client first.',
  FILE_NOT_AVAILABLE:
    'This file can’t be downloaded: it is still being checked, or it was blocked.',
};

export const STATUS: Record<
  ReviewedLeadStatus,
  { label: string; tone: 'info' | 'warning' | 'success' | 'neutral' }
> = {
  SUBMITTED: { label: 'New', tone: 'info' },
  IN_REVIEW: { label: 'In review', tone: 'warning' },
  CONVERTED: { label: 'Converted', tone: 'success' },
  DECLINED: { label: 'Declined', tone: 'neutral' },
};
