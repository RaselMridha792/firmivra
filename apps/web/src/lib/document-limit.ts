'use client';

import { UPLOAD_LIMITS } from '@firmivra/types';
import { useQuery } from '@tanstack/react-query';
import { api } from './api';

const MB = 1024 * 1024;

/**
 * DOCUMENTS-LIMIT-01 (Intake Forms Review Two): the largest regular document a firm takes, in
 * bytes, from its limit in MB (Documents > Settings > File Settings: 5 to 100). Unknown (still
 * loading, or not readable by this member) is the platform's 100 MB: the upload ticket still
 * refuses a file over the firm's limit and says it.
 */
export const documentMaxBytes = (mb: number | null | undefined): number =>
  mb ? Math.min(mb * MB, UPLOAD_LIMITS.maxBytes) : UPLOAD_LIMITS.maxBytes;

/** The firm's document limit in bytes, for staff upload screens (Documents settings). */
export function useFirmDocumentMaxBytes(): number {
  const settings = useQuery({
    queryKey: ['document-settings'],
    queryFn: () => api.documentLibrary.settings(),
    retry: false,
  });
  return documentMaxBytes(settings.data?.maxFileSizeMb);
}
